-- ============================================================
-- Factor Universe Cache
-- Persists per-symbol factor values for cross-section research
-- ============================================================

CREATE TABLE IF NOT EXISTS factor_universe (
  symbol         TEXT NOT NULL,
  factor_name    TEXT NOT NULL,
  factor_value   NUMERIC,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  sector         TEXT,
  market_cap     NUMERIC,
  PRIMARY KEY (symbol, factor_name)
);

CREATE INDEX IF NOT EXISTS idx_factor_universe_factor
  ON factor_universe(factor_name, factor_value);
CREATE INDEX IF NOT EXISTS idx_factor_universe_expires
  ON factor_universe(expires_at);
CREATE INDEX IF NOT EXISTS idx_factor_universe_sector
  ON factor_universe(sector, factor_name);

ALTER TABLE factor_universe ENABLE ROW LEVEL SECURITY;
CREATE POLICY "factor_universe_read_all" ON factor_universe FOR SELECT USING (true);

COMMENT ON TABLE factor_universe IS 'Cached factor values for cross-section factor research (Phase II)';
COMMENT ON COLUMN factor_universe.expires_at IS '24h TTL by default';
