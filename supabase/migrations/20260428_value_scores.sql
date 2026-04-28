-- Value scores table: stores fundamental metrics + computed value score per symbol
CREATE TABLE IF NOT EXISTS value_scores (
  symbol              TEXT PRIMARY KEY,
  pe_ratio            NUMERIC(10, 2),
  pb_ratio            NUMERIC(10, 2),
  ps_ratio            NUMERIC(10, 2),
  free_cashflow       BIGINT,
  dividend_yield      NUMERIC(6, 4),
  debt_to_equity      NUMERIC(10, 2),
  roe                 NUMERIC(6, 4),
  revenue_growth      NUMERIC(6, 4),
  earnings_growth     NUMERIC(6, 4),
  value_score         NUMERIC(5, 2) NOT NULL DEFAULT 0,
  value_tier          TEXT CHECK (value_tier IN ('deep_value','value','fair','expensive','avoid')) DEFAULT 'fair',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_value_scores_score ON value_scores(value_score DESC);
CREATE INDEX IF NOT EXISTS idx_value_scores_tier  ON value_scores(value_tier);

ALTER TABLE value_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "value_scores_read" ON value_scores
  FOR SELECT USING (true);

CREATE POLICY "value_scores_service_write" ON value_scores
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
