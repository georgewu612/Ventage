# Ventage 全站审计清单

> 内部使用文档。所有发现的 bugs、改进点、TODO 集中记录。
> 不对外公开。修复后在条目前打 ✅。

---

## 优先级定义

- **P0** 🚨 影响交易决策的正确性 / 数据准确性 / 安全。必须立刻修。
- **P1** ⚠️ 影响 UX 或可用性。下个迭代修。
- **P2** 💡 改进建议。想到再做。

---

## 索引

| 页面         | 文件                         |  P0 |  P1 |  P2 |
| ------------ | ---------------------------- | --: | --: | --: |
| `/dashboard` | `src/app/dashboard/page.tsx` |   0 |   5 |   7 |

---

## L2-01 · `/dashboard` (My Desk 首页)

**审计日期**：2026-05-14
**文件**：`src/app/dashboard/page.tsx`（614 行）
**审计来源**：Explore agent 全文扫描

### 🚨 P0 问题（无）

无影响交易决策的严重问题。

---

### ⚠️ P1 问题（5 条）

#### P1-1 · API 错误无任何 UI 提示

- **位置**：lines 135-140
- **现象**：`useMarketRegime()` 或 `useMarketSignals()` 接口失败时，UI 静默回退到空状态，用户以为"今天没机会"，实际上是接口挂了
- **影响**：用户看到空白页面，无法区分"真的没信号"还是"数据没拉到"
- **修复**：添加 `if (error) {…}` 分支，显示红色错误条 + 重试按钮
- **状态**：⬜ 未修

#### P1-2 · Supabase 直查无 loading 状态

- **位置**：lines 143-188（Watchlist / Alerts / Strategy / Portfolio 4 个表）
- **现象**：页面立即渲染所有区块，数据异步填充
- **效果**：用户看到 "no watchlist / no alerts" 闪一下，然后数据才出来
- **修复**：添加 `loadingSupabase` 状态，加载期间显示 skeleton
- **状态**：⬜ 未修

#### P1-3 · 信号去重 + 过滤无 useMemo

- **位置**：lines 190-214
- **现象**：每次 render 都重算 best-by-symbol dedup + bullish/bearish 过滤
- **影响**：实时信号推送时（每 30 秒）会反复触发 N 次重算
- **修复**：`useMemo(() => […], [signals])` 包起来
- **状态**：⬜ 未修

#### P1-4 · VIX 警告文案硬编码非 i18n

- **位置**：lines 316, 322
- **现象**：`VIX {regime.vix?.toFixed(1)} — elevated volatility regime` 文案直接写在 JSX 里
- **影响**：中文用户看到英文警告
- **修复**：抽到 `messages.ts` 的 `regime.vixElevated` / `regime.vixVeryHigh`
- **状态**：⬜ 未修

#### P1-5 · SignalCard 双 onClick 重复触发

- **位置**：lines 288-295, 339-349
- **现象**：包裹的 div 有 onClick，里面的 SignalCard 也有 onClick，事件冒泡触发两次
- **影响**：分析数据被双倍统计 / 性能开销
- **修复**：去掉外层 wrapper 的 onClick，只保留 SignalCard 内部的
- **状态**：⬜ 未修

---

### 💡 P2 改进点（7 条）

#### P2-1 · 信号阈值魔法数字

- **位置**：lines 65, 75, 202, 212, 214
- 阈值 60 / 65 / 75，limit 5 / 4，硬编码散落多处
- 建议抽到 `const HOME_SIGNAL_CONFIG = { minScore: 60, ... }`

#### P2-2 · PortfolioSummary 死字段

- **位置**：lines 181-182
- `total_value` / `total_pnl` 强制赋 null 但接口里有定义，UI 也没用
- 建议要么真的拉数据，要么从 interface 删掉这两个字段

#### P2-3 · 接口里有定义但永不展示的字段

- `WatchlistItem.notes`（line 37）拉到但不显示
- `AlertHistoryItem.signal_score`（line 44）只显示数字没上下文
- 建议要么展示要么从 select 列表去掉

#### P2-4 · Watchlist / Alerts / Strategy 不实时更新

- 只有 market_signals 接 Supabase Realtime
- 其他 3 个表（watchlist / alert_history / strategy_runs）只在 mount 时拉一次
- 用户在另一个 tab 加股票到 watchlist，本页不会更新
- 建议给 3 个表也接 Realtime 订阅，但要注意取消订阅清理

#### P2-5 · 数据源快捷按钮缺 darkpool 之外的图标统一

- DataSourceShortcut 6 个按钮的图标风格略不一致
- 建议统一从 lucide-react 选同一风格

#### P2-6 · 无分页机制

- Watchlist 上限 8 / Alerts 上限 5 / Strategy 上限 3
- 用户老数据看不到，需要跳到独立页面
- 建议每个区块加一个 "+ 显示更多" 折叠按钮

#### P2-7 · Plan badge 渲染每次重算

- lines 217-222，每次 render 跑 `locale === "zh"` 三元判断
- 不算大开销，但可以 useMemo

---

### 📊 页面快速指标

| 指标            |                                  数值 | 评价                     |
| --------------- | ------------------------------------: | ------------------------ |
| 总行数          |                                   614 | 偏大，可拆分子组件       |
| useEffect 数    |                                     1 | OK                       |
| useState 数     |                                     5 | OK                       |
| 内联子组件      | 2 (SectionHeader, DataSourceShortcut) | OK                       |
| 引入组件        |                                     4 | OK                       |
| Lucide 图标     |                                    20 | 偏多                     |
| Supabase 直查表 |                                     4 | 较多，可考虑后端聚合接口 |
| 外部 API        |                                     2 | OK                       |
| i18n key 引用   |                                   20+ | 良好                     |
| 内部导航 link   |                                   15+ | 良好                     |
| 无错误处理路径  |                                    ~8 | **需要修复（P1-1）**     |

---

## 修复优先级总览

下次专门修复 session 建议顺序：

1. **P1-1**（错误提示）— 影响最大，1 小时
2. **P1-2**（loading skeleton）— 提升 UX，1 小时
3. **P1-4**（VIX i18n）— 多语用户痛点，30 分钟
4. **P1-5**（双 onClick）— 简单清理，10 分钟
5. **P1-3**（useMemo）— 性能优化，20 分钟
