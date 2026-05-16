/**
 * Manual content manifest — AUTO-GENERATED, do not edit by hand.
 *
 * Source files: src/content/manual/{slug}.{zh|en}.md
 * Regenerate:   npm run generate:manual
 *
 * Locale convention: {slug}.zh.md is required, {slug}.en.md is optional.
 * Pages without an .en.md fall back to .zh.md with a UI notice.
 */

export interface ManualEntry {
  slug: string;
  titleZh: string;
  titleEn: string;
  excerptZh: string;
  excerptEn: string;
  bodyZh: string;
  /** Null when no .en.md exists; UI must fall back to bodyZh + show notice. */
  bodyEn: string | null;
}

interface RawEntry { zh: string; en: string | null }

const MANUAL_FILES: Record<string, RawEntry> = {
  "00-overview": {
    zh: `# Ventage 是什么 · 解决什么问题

> 5 分钟读完，理解整个平台的定位和模块组合。

---

## 一句话定位

**Ventage = 给个人和小团队用的「机构级 AI 量化研究终端」。**

把对冲基金里几百万美金的工作流（多源情报融合 + 多智能体研究 + 因子研究 + 形态识别 + 回测）压缩成单个用户就能用的工具。

---

## 解决的核心问题

| 散户/小团队的痛点                                       | Ventage 的解法                                      |
| ------------------------------------------------------- | --------------------------------------------------- |
| 信息源太多看不过来（期权、内部人、暗池、新闻、社交...） | 6 维度数据融合 → 一个综合分 + 等级 A/B/C            |
| 看到信号了不知道入场点                                  | 蔡森 12 形态识别 + 等幅满足计算给精确价位           |
| 回测看着好，实盘亏钱                                    | PIT (Point-In-Time) 回测系统，无 look-ahead 偏差    |
| 不知道当前是什么市场                                    | Regime 引擎自动识别 6 种状态（趋势/震荡/反转/事件） |
| 不会构建组合                                            | AI Portfolio Builder 一键生成 + AI 多角色分析       |
| 持仓没在看                                              | 实时告警 + 触发条件监控 + 5 种自动报告              |

---

## 五大功能层

\`\`\`
┌─────────────────────────────────────────────────┐
│  L1 入口层：注册 / 登录 / 定价 / 会员             │
├─────────────────────────────────────────────────┤
│  L2 核心层：My Desk + 工作台 + 持仓 + 告警        │  ← 每天用最多
├─────────────────────────────────────────────────┤
│  L3 策略研究：策略库 + Quant Lab + 信号复盘        │  ← 深度研究
├─────────────────────────────────────────────────┤
│  L4 数据情报：期权 / 内部人 / 暗池 / 新闻 / 情绪    │  ← 单维度深挖
│              / 技术 / 多智能体                    │
├─────────────────────────────────────────────────┤
│  L5 运营管理：报告 / 执行 / 后台 / 设置            │  ← 系统功能
└─────────────────────────────────────────────────┘
\`\`\`

---

## 三大核心引擎

### 1. Trading System v2（多状态自适应交易系统）

**六维度协同评分**：

| 维度         | 引擎                                                    | 评分占比 |
| ------------ | ------------------------------------------------------- | -------: |
| 市场状态     | Regime Classifier（6 态：趋势 / 震荡 / 反转 / 事件...） |      25% |
| 价格结构     | 蔡森 12 形态识别 + 等幅满足计算                         |       8% |
| 动量         | RSI / MACD / EMA13-34-55                                |      12% |
| **成交量**   | Volume Engine（节奏 / 量价 / 突破质量 / 衰竭）          |  **18%** |
| **筹码结构** | Chip Structure（Volume Profile + HVN/LVN + 成本迁移）   |  **22%** |
| 风报比       | Trade Manager（4 类退出 + 仓位算法）                    |      15% |

最终输出 0-100 综合分 + **A/B/C 等级**。

### 2. Factor Research System（因子研究系统）

基于《因子投资：方法与实践》（石川等，2020）方法论：

- **横截面排序**：全市场按因子值排序，分位数收益对比
- **Fama-MacBeth 回归**：测试因子是否真被定价（Newey-West HAC 调整）
- **PIT 回测**：每月末重新筛选，零 look-ahead 偏差
- **多策略 Ensemble**：等权多空对冲，AQR Style Premia 方法
- **质量分桶**：验证 \`pattern_quality_score\` 是否真有 alpha

### 3. AI 多角色分析

7 个虚拟分析师（基本面 / 技术 / 情绪 / 新闻 / 多头 / 空头 / 风险经理）+ 交易员决策，单次 GPT-4o 调用模拟出投资委员会辩论。

输出：BUY / HOLD / SELL + 信心等级 + 入场区间 + 止损位 + 第一目标价。

---

## 推荐学习路径

| 你的角色         | 优先看                                                            |
| ---------------- | ----------------------------------------------------------------- |
| **第一次用**     | 00 总览 → L2-01 My Desk → L2-02 工作台 → 实操点一只股票走完整流程 |
| **想看持仓管理** | L2-03 持仓 → L2-04 AI 组合构建器 → L2-05 告警                     |
| **想做量化研究** | L3-02 Quant Lab（6 个 Tab 重点理解 PIT 回测 + Fama-MacBeth）      |
| **想看数据情报** | L4-data-intelligence 任意页面                                     |
| **管理员/开发**  | L5-operations + \`docs/audit/\` 内部审计                            |

---

## 设计原则

Ventage 的所有功能遵循 4 条铁律：

1. **诚实分析（Honest Analysis）** — 即使发现回测胜率低于预期，也如实展示，不修饰
2. **Explainable** — 拒绝纯黑盒。每个评分都能追溯到具体子项
3. **PIT（Point-In-Time）** — 任何回测都必须无 look-ahead，使用当时能拿到的数据
4. **Zero Hallucination** — AI 只做归纳分析，所有数字由代码计算后传给 AI

---

## 数据源

- **价格数据**：yfinance（免费）+ Polygon.io（付费可选）
- **基本面**：yfinance 财务三表
- **期权流向**：Polygon.io
- **内部人交易**：SEC EDGAR Form 4
- **暗池**：FINRA + IEX Cloud
- **新闻**：自建抓取 + NewsAPI
- **情绪**：自建 NLP（TextBlob + 自定义金融词典）
- **AI 模型**：OpenAI GPT-4o

---

## 下一步

→ 接着读 [\`L2-01-dashboard.md\`](L2-01-dashboard.md) 了解登录后的第一页
`,
    en: `# What Is Ventage — and What Problem Does It Solve?

> 5-minute read. Get the platform's positioning and module overview.

---

## Positioning

**Ventage = an institutional-grade AI quantitative research terminal for individuals and small teams.**

It compresses the workflows that hedge funds spend millions building (multi-source intelligence fusion + multi-agent research + factor research + pattern recognition + backtesting) into a single-user product.

---

## Pain Points We Solve

| Retail / small-team pain                                           | Ventage's answer                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Too many information sources (options, insiders, dark pool, news…) | 6-dimension data fusion → single composite score + A/B/C grade                  |
| Saw the signal but don't know where to enter                       | Cai Sen's 12 chart patterns + measured-move targets give precise price levels   |
| Backtest looks great but real money loses                          | Point-In-Time (PIT) backtest system, zero look-ahead bias                       |
| Don't know the current market regime                               | Regime engine auto-classifies 6 states (trending / ranging / reversal / event…) |
| Don't know how to build a portfolio                                | AI Portfolio Builder one-click generation + AI multi-role analysis              |
| Forget to watch existing positions                                 | Real-time alerts + trigger-condition monitoring + 5 auto-generated reports      |

---

## Five Functional Layers

\`\`\`
┌─────────────────────────────────────────────────────┐
│  L1 Entry: signup / login / pricing / membership    │
├─────────────────────────────────────────────────────┤
│  L2 Core: My Desk + Workbench + Portfolio + Alerts  │  ← daily-use
├─────────────────────────────────────────────────────┤
│  L3 Strategy Research: Strategies + Quant Lab       │  ← deep research
│                       + Signal Journal              │
├─────────────────────────────────────────────────────┤
│  L4 Data Intelligence: options / insider / dark     │  ← single-source drill-down
│       pool / news / sentiment / technical /         │
│       multi-agent                                    │
├─────────────────────────────────────────────────────┤
│  L5 Operations: reports / execution / admin /       │  ← system
│       settings                                       │
└─────────────────────────────────────────────────────┘
\`\`\`

---

## Three Core Engines

### 1. Trading System v2 (Multi-State Adaptive)

**Six-dimension scoring:**

| Dimension          | Engine                                                     |  Weight |
| ------------------ | ---------------------------------------------------------- | ------: |
| Market regime      | Regime Classifier (6 states: trending / ranging / etc.)    |     25% |
| Price structure    | Cai Sen 12-pattern recognition + measured-move targets     |      8% |
| Momentum           | RSI / MACD / EMA13-34-55                                   |     12% |
| **Volume**         | Volume Engine (rhythm / price-vol / breakout / exhaustion) | **18%** |
| **Chip structure** | Volume Profile + HVN/LVN + cost migration                  | **22%** |
| Risk/reward        | Trade Manager (4 exit types + position sizing)             |     15% |

Final output: 0-100 composite score + **A / B / C grade**.

### 2. Factor Research System

Built on the methodology of _Factor Investing: Methods and Practice_ (Shi Chuan et al., 2020):

- **Cross-section sort**: rank the whole market by factor value, quintile returns
- **Fama-MacBeth regression**: test whether factors are actually priced (Newey-West HAC-adjusted)
- **PIT backtest**: re-screen at each month-end, zero look-ahead bias
- **Multi-strategy ensemble**: equal-weight long-short, AQR Style Premia approach
- **Quality bucket analysis**: verify whether \`pattern_quality_score\` carries real alpha

### 3. AI Multi-Role Analysis

7 virtual analysts (fundamentals / technical / sentiment / news / bull / bear / risk manager) + trader decision, simulated by a single GPT-4o call producing an investment-committee debate.

Output: BUY / HOLD / SELL + conviction level + entry zone + stop-loss + first profit target.

---

## Recommended Reading Path

| Your role          | Read in this order                                                         |
| ------------------ | -------------------------------------------------------------------------- |
| **First time**     | 00 Overview → L2-01 My Desk → L2-02 Workbench → walk one ticker end-to-end |
| **Portfolio user** | L2-03 Portfolio → L2-04 AI Portfolio Builder → L2-05 Alerts                |
| **Quant research** | L3-02 Quant Lab (6 tabs — focus on PIT backtest + Fama-MacBeth)            |
| **Data drill**     | Any L4 page                                                                |
| **Admin / dev**    | L5 Operations + \`docs/audit/\` internal audit                               |

---

## Design Principles

All Ventage features follow 4 ironclad rules:

1. **Honest Analysis** — even if a backtest's win rate disappoints, we report it as-is, no spin
2. **Explainable** — no pure black boxes; every score can be traced to its sub-components
3. **PIT (Point-In-Time)** — every backtest uses only data available at that historical moment
4. **Zero Hallucination** — AI only summarizes; all numbers are computed in code and passed to the model

---

## Data Sources

- **Prices**: yfinance (free) + Polygon.io (paid, optional)
- **Fundamentals**: yfinance financial statements
- **Options flow**: Polygon.io
- **Insider trading**: SEC EDGAR Form 4
- **Dark pool**: FINRA + IEX Cloud
- **News**: in-house scraper + NewsAPI
- **Sentiment**: custom NLP (TextBlob + financial lexicon)
- **AI**: OpenAI GPT-4o

---

## Next Step

→ Continue with [\`L2-01-dashboard.md\`](L2-01-dashboard.md) to learn the post-login home page.
`,
  },
  "L2-01-dashboard": {
    zh: `# L2-01 · My Desk 首页 \`/dashboard\`

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

**数据来源**：\`GET /v1/market/regime\` → 后端基于 VIX、SPY 200MA、行业广度计算

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
3. 决定要深入研究 → 点卡片里的代码跳到 \`单股工作台\` 做 6 维度评估
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

\`\`\`
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
\`\`\`

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

3. **点进去做深度分析**：跳到 \`单股工作台\`
   - 看蔡森形态识别 / Trading System v2 三引擎 / DCF 估值 / Quality Score
   - 综合判断后决定是否入场

4. **检查右侧 My Desk**：
   - Watchlist 里的股票今天有什么动静？
   - 最近告警有没有错过的？
   - 策略回测跑完了没？

5. **如果有持仓**：点 Portfolio Risk → 进 \`持仓\` 页看完整诊断

---

### 进阶用法：风险监控

**场景**：你重仓 5 只科技股，今天 VIX 突然到 25+

操作：

1. 打开首页看到红色 VIX 警告 → 知道环境恶化
2. Risk Desk 出现 3+ 条空头信号 → 进一步确认大势走弱
3. 跳到 \`持仓\` 页看每只股的 trailing stop 是否触发
4. 决定：减仓 30% / 全部止损 / 还是逢低加码

---

## 📸 学习建议（首次使用）

打开 \`/dashboard\` 后：

1. 截一张完整页面图，标注 4 个主要区块
2. 点一张 High Conviction 卡片，看 Signal Detail 长什么样
3. 把 5 只 High Conviction 全部点一遍，对比哪只你最想买
4. 看 Market Pulse 的 AI 总结一句话，理解今天的"市场基调"
5. 检查 My Desk 右侧每个小块的数据是否符合你的实际账户

---

## 🔗 关联页面

- 信号点开 → \`/dashboard/stocks/[symbol]\` 工作台
- "View All" 信号 → \`/dashboard/alerts\`
- "View Portfolio" → \`/dashboard/portfolio\`
- Data Sources 6 按钮 → 各 L4 数据情报页

---

## 📝 文案约定

- **Market Pulse** = 市场脉搏（不翻译成"市场体制"，太学术）
- **High Conviction Setups** = 高置信做多机会
- **Risk Desk** = 风险台
- **My Desk** = 我的工作台（区别于 Stock Workbench "单股工作台"）
- **Regime** = 体制 / 状态（保持英文，已成行业标准词）
`,
    en: `# L2-01 · My Desk — \`/dashboard\`

> The first page you see after login. Daily entry point to Ventage.

---

## 🎯 Positioning

**Within 30 seconds of opening the platform pre-market, you know whether to trade today, what the opportunities are, and what risks to watch.**

Analogy: it's the pilot's pre-flight checklist. Is the market environment normal? What A-grade opportunities are on the signal panel? Any changes to my positions or alerts?

---

## 👤 Who Uses It · When

| Role                   | Scenario                                                               |
| ---------------------- | ---------------------------------------------------------------------- |
| **Intraday / scalper** | 9:00 ET pre-market scan — decide whether to attack or wait today       |
| **Position investor**  | Daily check for new alerts / risk triggers on existing holdings        |
| **New user**           | Don't know what to look at — pick one of the 5 High-Conviction tickers |

---

## 🏗 Page Layout (plain language)

Two-column layout: **two main signal areas on the left** (2/3 width) + **My Desk personal panel on the right** (1/3 width).

📸 **[Suggested screenshot: full page, all four blocks visible]**

---

### Block 1: Market Pulse

📍 Top horizontal bar — the single most important row on the page.

Shows:

- **Regime badge**: risk appetite state (🟢 risk_on / 🟡 neutral / 🔴 risk_off)
- **VIX level**: current value + low/normal/high/very-high band
- **Breadth**: advancers vs decliners
- **Style tilt**: is growth or value leading today?
- **AI summary**: one-liner telling you "how to trade today"

**Why it matters**: this row decides **whether all the signals below are usable**.

- 🟢 risk_on: trade normally
- 🟡 neutral: half size
- 🔴 risk_off + VIX very high → **every signal below auto-demotes one grade** (A → B, B → C)

📸 **[Suggested screenshot: Market Pulse block alone]**

**Data source**: \`GET /v1/market/regime\` → FastAPI computes from VIX, SPY 200MA, sector breadth.

---

### Block 2: High Conviction Setups (top long ideas)

📍 Middle left. Up to **5** A-grade long signals.

Each signal card shows:

- Ticker + current price
- Direction (up arrow 🔼)
- **Score 0-100** (already demoted by market regime)
- Source types triggered (unusual options / insider buying / dark pool / …)

**Why it matters**: this is your "what to buy today" candidate list.

**Workflow**:

1. See a ticker you like → click the card
2. Right side slides open the **Signal Detail** panel with full analysis
3. Want to dig deeper → click the ticker to jump to \`Stock Workbench\` for the 6-dimension evaluation
4. Not satisfied? Click **"View All"** at the bottom for the full alerts history

📸 **[Suggested screenshot: 3 High Conviction cards + open Signal Detail panel]**

---

### Block 3: Risk Desk

📍 Lower left. Shows **short opportunities + neutral high-score anomalies**.

Why is this here?

- Long opportunities are easy to spot (media covers them). Shorts get ignored.
- When VIX is high, shorts often play out more safely than chasing rallies.

**Special feature — VIX auto-alert**:

- VIX in "high" band → **orange banner** appears at the top
- VIX in "very_high" band → **red banner**, recommend pausing all rally-chasing

**Why it matters**: portfolio exposure management. Even if you don't short, seeing 3+ short signals here = consider trimming.

📸 **[Suggested screenshot: Risk Desk + VIX warning banner (if active)]**

---

### Block 4: My Desk side panel (6 small blocks on the right)

Compact display of **6 categories tied to your personal account**:

#### 4-1 · Watchlist

- Up to 8 tickers you've starred
- Click ticker → jump to Stock Workbench

#### 4-2 · Recent Alerts

- Last 5 alert-history entries
- Shows ticker + direction + score

#### 4-3 · Data Sources shortcuts

- 6 buttons: Options / Insider / Dark Pool / Sentiment / Reports / Alerts
- Jump to the corresponding deep-dive page

#### 4-4 · Strategy Status

- Last 3 strategy-backtest runs
- ✅ done / 🔵 running / 🔴 failed / ⚪ pending

#### 4-5 · Portfolio Risk

- Current positions count + top holding
- Click "View Portfolio" → portfolio page

#### 4-6 · Plan Badge

- Your subscription tier (Free / Pro / Premium)

📸 **[Suggested screenshot: My Desk right column]**

---

## 🔌 Data Flow

\`\`\`
Page opens
   ↓
   ├─ useMarketRegime()  → GET /v1/market/regime
   │                       (FastAPI computes VIX + SPY 200MA + breadth)
   │
   ├─ useMarketSignals() → GET /v1/signals?min_score=60&limit=20
   │                       + Supabase Realtime push for new signals
   │
   └─ 4 parallel Supabase queries:
       ├─ watchlists       (your starred tickers)
       ├─ alert_history    (last 5 alerts)
       ├─ strategy_runs    (last 3 strategy runs)
       └─ portfolio_holdings (positions snapshot)
\`\`\`

**Note**: signal blocks update **in real time** (30 s polling + Supabase Realtime push). Other modules load once on page open.

---

## ✅ How to Use (workflow guide)

### Standard daily flow (9:00 ET)

1. **Check Market Pulse**: is today risk_on or risk_off?
   - 🟢 risk_on → use A-grade signals normally
   - 🟡 neutral → half size
   - 🔴 risk_off → prioritize Risk Desk shorts, or rest the day

2. **Scan High Conviction**: pick 1-2 of the 5 ideas that interest you
   - Look at the composite score → check if it's options + insider or single-source
   - Multi-source > single-source

3. **Deep-dive on the chosen one**: jump to \`Stock Workbench\`
   - Review Cai Sen pattern recognition / Trading System v2 three engines / DCF valuation / Quality Score
   - Make the entry decision

4. **Check the My Desk panel**:
   - Anything moving on your Watchlist today?
   - Any missed alerts?
   - Strategy backtests finished?

5. **If you have positions**: click Portfolio Risk → portfolio page for full diagnosis

---

### Advanced: risk monitoring

**Scenario**: you're heavy in 5 tech names, and VIX suddenly hits 25+

What to do:

1. Open the home page → see the red VIX warning → confirm environment is deteriorating
2. Risk Desk shows 3+ short signals → confirms broader weakness
3. Jump to \`Portfolio\` page, check trailing stops on each name
4. Decide: trim 30% / stop out all / hold and DCA — your call

---

## 📸 Learning Tips (first time)

When you open \`/dashboard\`:

1. Screenshot the whole page, label the 4 main blocks
2. Click one High Conviction card to see what Signal Detail looks like
3. Click all 5 High Conviction cards in turn, pick the one you'd most want to buy
4. Read the Market Pulse AI summary line to internalize today's "market tone"
5. Verify the right-side My Desk numbers match your actual account

---

## 🔗 Related Pages

- Click any signal → \`/dashboard/stocks/[symbol]\` workbench
- "View All" signals → \`/dashboard/alerts\`
- "View Portfolio" → \`/dashboard/portfolio\`
- 6 Data Sources buttons → each L4 intelligence page

---

## 📝 Terminology

- **Market Pulse** — the top "regime + VIX + breadth + style + AI tone" strip. We avoid the term "Market Regime" — too academic for everyday users.
- **High Conviction Setups** — the 5-card panel of top A-grade long ideas.
- **Risk Desk** — the short opportunities / neutral high-score anomalies panel.
- **My Desk** — your personal account side panel. Distinct from **Stock Workbench**, which is the per-ticker analysis page.
- **Regime** — market state (risk_on / neutral / risk_off). Kept as English jargon; it's industry-standard.
`,
  },
};

function extractTitle(body: string, slug: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m?.[1]?.trim() ?? slug;
}

function extractExcerpt(body: string): string {
  const para = body
    .replace(/^#.+$/gm, "")
    .replace(/^>.*$/gm, "")
    .split(/\n{2,}/)
    .find((p) => p.trim().length > 30 && !p.startsWith("---"));
  return (para ?? "").replace(/\s+/g, " ").slice(0, 160);
}

export const MANUAL_ENTRIES: ManualEntry[] = Object.entries(MANUAL_FILES)
  .map(([slug, raw]) => ({
    slug,
    titleZh: extractTitle(raw.zh, slug),
    titleEn: raw.en ? extractTitle(raw.en, slug) : extractTitle(raw.zh, slug),
    excerptZh: extractExcerpt(raw.zh),
    excerptEn: raw.en ? extractExcerpt(raw.en) : extractExcerpt(raw.zh),
    bodyZh: raw.zh,
    bodyEn: raw.en,
  }))
  .sort((a, b) => a.slug.localeCompare(b.slug));

export function getManualBySlug(slug: string): ManualEntry | null {
  return MANUAL_ENTRIES.find((e) => e.slug === slug) ?? null;
}
