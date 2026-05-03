-- ============================================================
-- Factor History — monthly point-in-time factor snapshots
-- Used by true OOS backtest (eliminates look-ahead bias)
-- Needs ≥6 monthly snapshots before PIT backtest is meaningful
-- ============================================================

CREATE TABLE IF NOT EXISTS factor_history (
  symbol         TEXT NOT NULL,
  factor_name    TEXT NOT NULL,
  factor_value   NUMERIC,
  snapshot_date  DATE NOT NULL,    -- typically month-end
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sector         TEXT,
  market_cap     NUMERIC,
  PRIMARY KEY (symbol, factor_name, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_factor_history_date_factor
  ON factor_history(snapshot_date DESC, factor_name);
CREATE INDEX IF NOT EXISTS idx_factor_history_symbol_date
  ON factor_history(symbol, snapshot_date DESC);

ALTER TABLE factor_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "factor_history_read_all" ON factor_history FOR SELECT USING (true);

COMMENT ON TABLE factor_history IS
  'Monthly point-in-time factor snapshots for true OOS backtests';
COMMENT ON COLUMN factor_history.snapshot_date IS
  'The "as of" date (typically month-end) when these factor values were captured';
