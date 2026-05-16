# L2-01 · My Desk 首页 `/dashboard`

> 这是登录后看到的第一页。每天进 Ventage 第一眼就看这里。

---

## 🎯 一句话定位

**早盘开机 30 秒内，让你知道今天该不该交易、有什么机会、要警惕什么风险。**

类比：相当于一份「机长起飞前的检查表」。市场环境是否正常？信号面板有什么 A 级机会？我的持仓和告警有什么变化？

---

## 👤 谁会用 · 什么场景

| 角色                | 场景                                                             |
| ------------------- | ---------------------------------------------------------------- |
| **日内/短线交易员** | 9:00 ET 盘前快速扫一遍，决定今天主攻还是观望                     |
| **持仓投资者**      | 每天进来看持仓股票有没有出新告警 / 触发风险                      |
| **新用户**          | 不知道看哪只股，先从「High Conviction」的 5 只里挑感兴趣的点进去 |

---

## 🏗 页面结构（白话）

页面分两栏：**左侧两个主信号区**（占 2/3）+ **右侧 My Desk 个人面板**（占 1/3）。

📸 **[建议截图：完整页面截图，能看清整体布局]**

---

### 区块 1：Market Pulse（市场脉搏）

📍 顶部横向，整页最重要的一行。

显示：

- **市场体制（Regime）徽章**：风险偏好状态（🟢 risk_on / 🟡 neutral / 🔴 risk_off）
- **VIX 波动率水平**：当前 VIX 值 + 偏低/正常/偏高/极高
- **市场广度**：上涨家数 vs 下跌家数对比
- **风格倾向**：今天是 growth 还是 value 占优
- **AI 总结**：一句话告诉你"今天该怎么交易"

**业务意义**：这一行决定**所有信号该不该用**。

- 🟢 risk_on：可以正常出手
- 🟡 neutral：保持一半仓位
- 🔴 risk_off + VIX 极高 → **下面的所有信号都自动降级一档**，A 变 B，B 变 C

📸 **[建议截图：Market Pulse 区块单独截图]**

**数据来源**：`GET /v1/market/regime` → 后端基于 VIX、SPY 200MA、行业广度计算

---

### 区块 2：High Conviction Setups（高置信做多机会）

📍 左侧中间。最多显示 **5 条** A 级做多信号。

每条信号卡片包含：

- 股票代码 + 当前价
- 信号方向（向上箭头 🔼）
- **总分 0-100**（已经按市场状态降级过的）
- 触发的信号源类型（unusual options / insider buying / dark pool 等）

**业务意义**：这是你"今天可以买什么"的备选清单。

**操作流程**：

1. 看到感兴趣的代码 → 点卡片
2. 右侧弹出 **Signal Detail 侧栏**，展示完整分析
3. 决定要深入研究 → 点卡片里的代码跳到 `单股工作台` 做 6 维度评估
4. 还不满意？点底部 **"View All"** 去告警历史看更多

📸 **[建议截图：3 张 High Conviction 卡片 + Signal Detail 弹出的样子]**

---

### 区块 3：Risk Desk（风险台）

📍 左侧下方。显示**做空机会 + 中性高分异常**。

为什么放这里？

- 做多机会容易看到（媒体宣传多），做空机会容易被忽略
- 当 VIX 高位时，做空往往比追多更稳

**特别功能 — VIX 自动告警**：

- VIX 进入 "high" 区间 → 顶部出现**橙色横幅警告**
- VIX 进入 "very_high" → 出现**红色横幅**，建议暂停所有追多操作

**业务意义**：风险敞口管理。即使你不想做空，看到这里有 3+ 条空头信号 = 应该减仓。

📸 **[建议截图：风险台 + VIX 警告横幅（如果当时有触发）]**

---

### 区块 4：My Desk 个人面板（右侧 6 小块）

紧凑展示**与你个人账户相关**的 6 类信息：

#### 4-1 · Watchlist 关注列表

- 最多 8 只你之前标记关注的股票
- 点代码直接跳到工作台

#### 4-2 · Recent Alerts 最近告警

- 最近 5 条告警历史
- 显示股票 + 方向 + 分数

#### 4-3 · Data Sources 数据源快捷

- 6 个按钮：期权 / 内部人 / 暗池 / 情绪 / 报告 / 告警
- 跳转到对应深度页

#### 4-4 · Strategy Status 策略运行状态

- 最近 3 次策略回测的状态
- ✅ done / 🔵 running / 🔴 failed / ⚪ pending

#### 4-5 · Portfolio Risk 持仓风险

- 当前持仓数 + 最大单股
- 点 "View Portfolio" 进持仓页

#### 4-6 · Plan Badge 会员等级

- 显示你的订阅等级（Free / Pro / Premium）

📸 **[建议截图：My Desk 右侧整列]**

---

## 🔌 数据流

```
页面打开
   ↓
   ├─ useMarketRegime()  → GET /v1/market/regime
   │                       (FastAPI 计算 VIX + SPY 200MA + 行业广度)
   │
   ├─ useMarketSignals() → GET /v1/signals?min_score=60&limit=20
   │                       + Supabase Realtime 实时新信号推送
   │
   └─ 并发 4 个 Supabase 直查：
       ├─ watchlists       (用户的关注列表)
       ├─ alert_history    (最近 5 条告警)
       ├─ strategy_runs    (最近 3 次策略回测)
       └─ portfolio_holdings (持仓快照)
```

**特别说明**：信号区会**实时更新**（30 秒轮询 + Supabase Realtime 推送），其他模块是页面打开时一次性加载。

---

## ✅ 怎么用（操作教程）

### 标准日常流程（每天早上 9:00 ET）

1. **看 Market Pulse**：今天是 risk_on 还是 risk_off？
   - 🟢 risk_on → 正常用 A 级信号
   - 🟡 neutral → 减半仓位
   - 🔴 risk_off → 优先看 Risk Desk 做空机会，或者休息一天

2. **扫 High Conviction**：5 条机会里挑 1-2 个感兴趣的
   - 看综合分 → 看是 options + insider 还是单一信号源
   - 多源融合的 > 单源的

3. **点进去做深度分析**：跳到 `单股工作台`
   - 看蔡森形态识别 / Trading System v2 三引擎 / DCF 估值 / Quality Score
   - 综合判断后决定是否入场

4. **检查右侧 My Desk**：
   - Watchlist 里的股票今天有什么动静？
   - 最近告警有没有错过的？
   - 策略回测跑完了没？

5. **如果有持仓**：点 Portfolio Risk → 进 `持仓` 页看完整诊断

---

### 进阶用法：风险监控

**场景**：你重仓 5 只科技股，今天 VIX 突然到 25+

操作：

1. 打开首页看到红色 VIX 警告 → 知道环境恶化
2. Risk Desk 出现 3+ 条空头信号 → 进一步确认大势走弱
3. 跳到 `持仓` 页看每只股的 trailing stop 是否触发
4. 决定：减仓 30% / 全部止损 / 还是逢低加码

---

## 📸 学习建议（首次使用）

打开 `/dashboard` 后：

1. 截一张完整页面图，标注 4 个主要区块
2. 点一张 High Conviction 卡片，看 Signal Detail 长什么样
3. 把 5 只 High Conviction 全部点一遍，对比哪只你最想买
4. 看 Market Pulse 的 AI 总结一句话，理解今天的"市场基调"
5. 检查 My Desk 右侧每个小块的数据是否符合你的实际账户

---

## 🔗 关联页面

- 信号点开 → `/dashboard/stocks/[symbol]` 工作台
- "View All" 信号 → `/dashboard/alerts`
- "View Portfolio" → `/dashboard/portfolio`
- Data Sources 6 按钮 → 各 L4 数据情报页

---

## 📝 文案约定

- **Market Pulse** = 市场脉搏（不翻译成"市场体制"，太学术）
- **High Conviction Setups** = 高置信做多机会
- **Risk Desk** = 风险台
- **My Desk** = 我的工作台（区别于 Stock Workbench "单股工作台"）
- **Regime** = 体制 / 状态（保持英文，已成行业标准词）
