# What Is Ventage — and What Problem Does It Solve?

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

```
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
```

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
- **Quality bucket analysis**: verify whether `pattern_quality_score` carries real alpha

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
| **Admin / dev**    | L5 Operations + `docs/audit/` internal audit                               |

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

→ Continue with [`L2-01-dashboard.md`](L2-01-dashboard.md) to learn the post-login home page.
