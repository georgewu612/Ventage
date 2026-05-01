-- ============================================================
-- Multi-Timeframe Confirmation Fields
-- Adds 4h MTF confirmation fields to strategy_signals
-- ============================================================

ALTER TABLE strategy_signals
  ADD COLUMN IF NOT EXISTS mtf_status     TEXT,
  ADD COLUMN IF NOT EXISTS mtf_score      NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS mtf_analysis   JSONB;

COMMENT ON COLUMN strategy_signals.mtf_status   IS '4h confirmation: confirmed | neutral | contradicted | no_data';
COMMENT ON COLUMN strategy_signals.mtf_score    IS '4h MTF confirmation score 0-100';
COMMENT ON COLUMN strategy_signals.mtf_analysis IS 'Full MTF analysis snapshot (sub-scores, indicators, tags, warnings)';

CREATE INDEX IF NOT EXISTS idx_strategy_signals_mtf_status
  ON strategy_signals(mtf_status, datetime DESC);
