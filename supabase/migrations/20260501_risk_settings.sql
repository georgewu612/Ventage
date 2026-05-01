-- ============================================================
-- Risk Engine User Settings
-- Adds 3 columns to profiles for per-user risk preferences
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS risk_account_size      NUMERIC(14,2) DEFAULT 100000,
  ADD COLUMN IF NOT EXISTS risk_preference        TEXT DEFAULT 'moderate'
    CHECK (risk_preference IN ('conservative','moderate','aggressive')),
  ADD COLUMN IF NOT EXISTS risk_max_position_pct  NUMERIC(5,2)  DEFAULT 25.00;

COMMENT ON COLUMN profiles.risk_account_size     IS 'User account size in USD for position sizing';
COMMENT ON COLUMN profiles.risk_preference       IS 'Risk tolerance affecting total exposure cap';
COMMENT ON COLUMN profiles.risk_max_position_pct IS 'Max % of account for any single position';
