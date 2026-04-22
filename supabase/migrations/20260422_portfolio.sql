-- Portfolio monitoring tables — Phase 3

-- ── 1. Portfolio Holdings（当前持仓）────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  symbol        TEXT NOT NULL,
  quantity      NUMERIC NOT NULL,
  avg_cost      NUMERIC NOT NULL,         -- average cost basis per share
  notes         TEXT,
  imported_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, symbol)
);

-- ── 2. Portfolio Snapshots（每日组合快照）────────────────────────────
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  total_value   NUMERIC NOT NULL,
  total_cost    NUMERIC NOT NULL,
  total_pnl     NUMERIC NOT NULL,
  positions     JSONB NOT NULL DEFAULT '[]',  -- [{symbol, qty, price, value, pnl_pct}]
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, snapshot_date)
);

-- ── 3. Risk Events（风险事件记录）────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,   -- 'concentration' | 'drawdown' | 'correlated' | 'custom'
  symbol        TEXT,
  severity      TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  message       TEXT NOT NULL,
  acknowledged  BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE portfolio_holdings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_events         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "holdings_self" ON portfolio_holdings FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "snapshots_self" ON portfolio_snapshots FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "risk_events_self" ON risk_events FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Indexes ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_holdings_user ON portfolio_holdings (user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_user_date ON portfolio_snapshots (user_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_user ON risk_events (user_id, created_at DESC);
