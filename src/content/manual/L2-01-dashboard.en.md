# L2-01 · My Desk — `/dashboard`

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

**Data source**: `GET /v1/market/regime` → FastAPI computes from VIX, SPY 200MA, sector breadth.

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
3. Want to dig deeper → click the ticker to jump to `Stock Workbench` for the 6-dimension evaluation
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

```
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
```

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

3. **Deep-dive on the chosen one**: jump to `Stock Workbench`
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
3. Jump to `Portfolio` page, check trailing stops on each name
4. Decide: trim 30% / stop out all / hold and DCA — your call

---

## 📸 Learning Tips (first time)

When you open `/dashboard`:

1. Screenshot the whole page, label the 4 main blocks
2. Click one High Conviction card to see what Signal Detail looks like
3. Click all 5 High Conviction cards in turn, pick the one you'd most want to buy
4. Read the Market Pulse AI summary line to internalize today's "market tone"
5. Verify the right-side My Desk numbers match your actual account

---

## 🔗 Related Pages

- Click any signal → `/dashboard/stocks/[symbol]` workbench
- "View All" signals → `/dashboard/alerts`
- "View Portfolio" → `/dashboard/portfolio`
- 6 Data Sources buttons → each L4 intelligence page

---

## 📝 Terminology

- **Market Pulse** — the top "regime + VIX + breadth + style + AI tone" strip. We avoid the term "Market Regime" — too academic for everyday users.
- **High Conviction Setups** — the 5-card panel of top A-grade long ideas.
- **Risk Desk** — the short opportunities / neutral high-score anomalies panel.
- **My Desk** — your personal account side panel. Distinct from **Stock Workbench**, which is the per-ticker analysis page.
- **Regime** — market state (risk_on / neutral / risk_off). Kept as English jargon; it's industry-standard.
