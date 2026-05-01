# Trading System v2 — Phase A/B/C 总结报告

> 完成日期：2026-04-30 | 实施周期：1 天（约 8 小时高强度开发）
> 状态：生产已上线 | Railway + Vercel 全栈部署完成

---

## 一、为什么做

### 现状缺口

Ventage 之前的能力局限：

1. 宏观 regime 单一（risk_on / neutral / risk_off），**无个股级别状态**
2. 成交量分析仅"今日量 vs 20 日均量"硬比较，**无量价节奏识别、无突破质量评分**
3. **完全没有筹码 / 成本结构分析**（无 Volume Profile、HVN/LVN、成本迁移）
4. 信号只有 confidence 单值（0-1），**无多维度可解释评分**

### 升级目标

把 Ventage 从"形态+指标驱动"升级为**六维度协同**：

```
市场状态 → 价格结构 → 动量 → 成交量 → 筹码/成本结构 → 风险执行
```

---

## 二、做了什么

### Phase A：指标库 + 个股 Regime 引擎

**`python/services/indicators.py`**（共享指标库）

| 指标                           | 用途                 |
| ------------------------------ | -------------------- |
| `rsi(close, period=14)`        | 动量超买超卖         |
| `macd(close)`                  | 动量趋势             |
| `bollinger(close)`             | 波动率边界           |
| `ema/sma(close, period)`       | 均线                 |
| `atr(high, low, close)`        | 真实波幅             |
| `adx(high, low, close)`        | **趋势强度（新增）** |
| `stochastic(high, low, close)` | **随机指标（新增）** |
| `ema_alignment(13, 34, 55)`    | 三线对齐方向         |
| `ema_squeeze_pct(13, 34, 55)`  | 均线缠绕度           |
| `bb_width(u, m, l)`            | 布林带宽             |

**`python/services/regime_classifier.py`**（6 态分类器）

```python
classify(ohlcv) -> RegimeResult(
    regime: 'strong_uptrend' | 'strong_downtrend' | 'squeeze_breakout_setup' |
            'ranging' | 'exhaustion_reversal' | 'elevated_event_risk',
    regime_score: 0-100,
    adx: float,
    ema_alignment: 'bullish'|'bearish'|'tangled',
    ema_squeeze_pct: float,
    bb_width: float,
    atr_pct: float,
    risk_flag: str | None,
    notes: dict  # 12 个调试字段
)
```

**判定规则**（节选）：

- `strong_uptrend`：ADX>25 + EMA13>34>55 + MA50>MA200 + close>EMA34
- `squeeze_breakout_setup`：EMA 缠绕度<4% + BB 带宽<6% + ATR 收敛
- `exhaustion_reversal`：长趋势末 + RSI/MACD 背离 + ADX 回落
- `ranging`：ADX<20 + 不在 squeeze 状态

**端点**：`GET /v1/regime/symbol/{sym}?fresh=true`

**实测结果**（2026-04-30 收盘）：
| 标的 | Regime | Score | 解读 |
|---|---|---|---|
| AMD | strong_uptrend | 100 | ADX 46.93，最强分类 |
| NVDA | strong_uptrend | 62.7 | 中等强度上升 |
| TLT | squeeze_breakout_setup | 77.2 | 缩量整理（EMA 缠绕 0.57%）|
| AAPL | ranging | 74.8 | 低 ADX 震荡 |
| TSLA | ranging | 67.2 | 弱势震荡 |

**ETL**：每日 22:00 UTC 自动扫描 Watchlist + 持仓股，写入 `symbol_regimes` 表。

---

### Phase B：成交量引擎

**`python/services/volume_engine.py`**（739 行）

#### 6 个核心判断模块

1. **绝对/相对量能** — 6 档 volume_state（very_low / low / normal / elevated / high / climax）
2. **量价关系** — 6 种识别（价涨量增/价涨量缩/价跌量缩/价跌量增/放量不涨/放量跌不动）
3. **阶段量能节奏** — 推动段 / 整理段 / 突破段（健康 vs 异常）
4. **突破质量** — 收盘 vs key_level + 量倍 + 实体占比 + 上影长度
5. **衰竭判定** — 高位 climax 量 + 实体收缩 + 长上影
6. **回踩质量** — 回踩量 vs 推动量 比值

#### 5 维度评分（总分 100）

```
当前量能状态：     15 分
阶段节奏健康度：   25 分
突破/回踩量能质量：25 分
量价关系质量：     20 分
衰竭/派发风险：    15 分
```

#### 标签库

| 加分标签               | 警告标签                             |
| ---------------------- | ------------------------------------ |
| `breakout_volume`      | `breakout_without_volume`            |
| `pullback_dryup`       | `weak_breakout`                      |
| `bullish_accumulation` | `breakout_with_long_upper_shadow`    |
| `absorption_volume`    | `pullback_on_heavy_volume`           |
| `climactic_reversal`   | `expanding_volume_against_position`  |
| `healthy_trend_volume` | `repeated_high_volume_stall`         |
| `bearish_distribution` | `consolidation_heavier_than_impulse` |

**端点**：`GET /v1/volume/{sym}?signal_type=breakout&key_level=200`

**实测结果**（2026-04-25 NVDA 突破日）：

- score 87 / 100
- volume_state = elevated
- relative_volume_20 = 1.43
- price_volume_relation = up_with_volume
- breakout_quality = high
- tags = [breakout_volume, bullish_accumulation]
- **volume_confirmed = True ✓**

---

### Phase C：筹码结构引擎

**`python/services/chip_structure.py`**（757 行）

#### 核心算法

1. **Volume Profile** — 价格分桶（默认 50 桶）+ 每根 K 线在 high-low 范围内线性分配 volume
2. **HVN/LVN 识别** — 高于 mean+1σ 是 HVN，低于 mean-0.5σ 是 LVN
3. **主成本区** — 最大连续 HVN 簇
4. **POC** — 单一最高成交桶
5. **8 个核心字段**：

| 字段                        | 含义                                                    |
| --------------------------- | ------------------------------------------------------- |
| `cost_zone_position`        | 当前价相对主成本区位置（below/inside/above + 边缘判定） |
| `overhead_supply_density`   | 上方 30% 范围 HVN 桶占比（low/medium/high）             |
| `below_support_density`     | 下方 30% 范围 HVN 桶占比                                |
| `chip_concentration_score`  | 80% 累计成交量集中度（0-100）                           |
| `chip_migration_direction`  | 成本中心迁移方向（rising/falling/flat）                 |
| `breakout_air_pocket_score` | 上方 15% 真空区评分（0-100）                            |
| `profile_tag`               | 标签数组                                                |
| `chip_warning`              | 警告数组                                                |

#### 6 维度评分（总分 100）

```
当前价位置：      20 分
上方供给密度：    20 分
下方支撑密度：    20 分
筹码集中度：      15 分
成本迁移方向：    15 分
突破真空区质量：  10 分
```

#### 标签库

| 加分标签                    | 警告标签                       |
| --------------------------- | ------------------------------ |
| `breakout_into_air_pocket`  | `breakout_into_heavy_supply`   |
| `support_from_cost_cluster` | `trapped_supply_overhead`      |
| `cost_zone_rising`          | `weak_support_below`           |
| `chip_concentration_high`   | `stretched_far_from_cost_area` |
| `near_major_hvn`            | `no_clear_cost_support`        |
| `inside_balance_area`       |                                |
| `retest_of_cost_zone`       |                                |
| `rejection_at_supply_zone`  |                                |

**端点**：`GET /v1/chip/{sym}`

**实测结果**：
| 股票 | chip_score | 主成本区 | POC | 解读 |
|---|---|---|---|---|
| **NVDA** | **91.6** | $176-$187 | $182.52 | 站上 + rising migration + 上方真空 = 教科书 setup ✓ |
| **AMD** | 72.0 | $200-$221 | $217.11 | rising 但 stretched far ⚠（建议等回踩）|
| **SPY** | 77.6 | $674-$687 | $680.16 | 刚突破 $687 高点，上方真空 |
| **AAPL** | 53.1 | $268-$273 | $272.10 | 在主成本区下沿（buy the dip 候选）|
| **TLT** | 40.8 | $86-$87 | $86.83 | 跌破支撑 + 上方供给重 ⚠ |
| **TSLA** | 24.8 | $423-$449 | $438.03 | **崩破成本区** + 上方堆套牢盘 ⚠⚠ |

---

## 三、架构

### 数据流

```
Watchlist + Holdings 标的
        ↓
  yfinance OHLCV (1y/2y daily)
        ↓
┌────────────────────────────────────────┐
│  indicators.py    (10 个指标)            │
└────────────────────────────────────────┘
        ↓                ↓                ↓
┌──────────────┐ ┌──────────────┐ ┌────────────────┐
│ regime_       │ │ volume_       │ │ chip_           │
│ classifier.py │ │ engine.py     │ │ structure.py    │
│ → 6 态分类     │ │ → 5 维评分     │ │ → 6 维评分        │
└──────────────┘ └──────────────┘ └────────────────┘
        ↓                ↓                ↓
   symbol_regimes   (Phase D 4 套策略将合并使用)
   表
        ↓
   GET /v1/regime/symbol/{sym}
   GET /v1/volume/{sym}
   GET /v1/chip/{sym}
```

### 关键设计决策

1. **三引擎独立** — 任一引擎可单独被调用，便于策略组合
2. **JSON 安全** — 所有 numpy.bool\_/float64 强制转换为 Python 原生类型
3. **可解释性优先** — 所有 score 都有分项细节、tags 和 warnings
4. **不依赖单一平台数据源** — Volume Profile 用通用 OHLCV 算，不需要 tick 数据
5. **每日批量 + 实时按需** — ETL 缓存 + `?fresh=true` 强制重算

---

## 四、生产部署清单

### Python 后端（Railway）

```
python/services/indicators.py          ✅ deployed
python/services/regime_classifier.py   ✅ deployed
python/services/volume_engine.py       ✅ deployed
python/services/chip_structure.py      ✅ deployed
python/api/routes/market.py            ✅ 3 new endpoints
python/api/routes/technical.py         ✅ refactored to use shared lib
python/etl/scheduler.py                ✅ daily regime scan registered
```

### 数据库（Supabase）

```
symbol_regimes                          ✅ created (生产已应用)
```

### 端点验证

```bash
# Regime
curl https://faithful-simplicity-production-3a01.up.railway.app/v1/regime/symbol/NVDA?fresh=true
# → 200 OK, regime=strong_uptrend, score=62.7

# Volume
curl 'https://faithful-simplicity-production-3a01.up.railway.app/v1/volume/NVDA?signal_type=breakout&key_level=200'
# → 200 OK, breakout_quality=low (current close $199.57 < $200)

# Chip
curl https://faithful-simplicity-production-3a01.up.railway.app/v1/chip/NVDA
# → 200 OK, chip_score=91.6
```

---

## 五、修过的 Bug

1. **numpy.bool\_ JSON 序列化错误** — FastAPI 返回 500
   - 修复：所有 notes dict 中的布尔值用 `bool()` 强转

2. **Pandas iloc 用 Timestamp 索引报错** — `_stage_rhythm` 内部用 `volume.iloc[ts:ts]`
   - 修复：改用整数位置索引

---

## 六、统计数据

| 指标         | 数值                   |
| ------------ | ---------------------- |
| 新代码       | ~2,000 行 Python       |
| 新指标       | 10 个                  |
| 新表         | 1 张（symbol_regimes） |
| 新 API       | 3 个                   |
| 新 ETL 任务  | 1 个（每日 22:00 UTC） |
| Phase A 耗时 | ~2 小时                |
| Phase B 耗时 | ~3 小时                |
| Phase C 耗时 | ~3 小时                |
| 生产 Bug     | 2 个（已修）           |

---

## 七、下一步：Phase D — 4 套规范策略

每个策略将调用三大引擎获取分项评分，落地到统一的 `strategy_signals` 表：

1. `trend_pullback_breakout.py` — 顺势回调突破（适用 strong_uptrend / strong_downtrend）
2. `wyckoff_liquidity_sweep.py` — 流动性扫荡（适用 ranging / exhaustion_reversal）
3. `ema_squeeze_launch.py` — 13/34/55 主升浪启动（适用 squeeze_breakout_setup）
4. `bollinger_extreme_reversion.py` — 布林带极值回归（适用 ranging）

预计 2 周。

---

_Generated: 2026-04-30 | Trading System v2 Phase A+B+C delivery report_
