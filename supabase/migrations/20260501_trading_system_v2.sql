-- ============================================================
-- Trading System v2 — Phase A: Per-symbol regime
--
-- Adds the symbol_regimes table for 6-state classification per ticker.
-- Strategy signals + outcomes tables come in Phase F (separate migration).
-- ============================================================

CREATE TABLE IF NOT EXISTS symbol_regimes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol          TEXT NOT NULL,
    timeframe       TEXT NOT NULL DEFAULT '1d',
    datetime        TIMESTAMPTZ NOT NULL,           -- Snapshot timestamp (typically last close)
    regime          TEXT NOT NULL CHECK (
        regime IN (
            'strong_uptrend',
            'strong_downtrend',
            'squeeze_breakout_setup',
            'ranging',
            'exhaustion_reversal',
            'elevated_event_risk'
        )
    ),
    regime_score    NUMERIC(5,1),                   -- 0-100 confidence
    adx             NUMERIC(7,2),
    ema_alignment   TEXT CHECK (ema_alignment IN ('bullish', 'bearish', 'tangled')),
    ema_squeeze_pct NUMERIC(7,2),                   -- max EMA13/34/55 dispersion (%)
    bb_width        NUMERIC(7,2),                   -- (upper-lower)/middle * 100
    atr_pct         NUMERIC(7,2),                   -- ATR as % of close
    risk_flag       TEXT,                            -- e.g. 'elevated_event_risk' or NULL
    notes           JSONB DEFAULT '{}',              -- Debug/observability fields
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Latest snapshot lookup per symbol+timeframe
CREATE INDEX IF NOT EXISTS idx_symbol_regimes_latest
    ON symbol_regimes (symbol, timeframe, datetime DESC);

-- Filter by regime (e.g. "show all symbols currently in strong_uptrend")
CREATE INDEX IF NOT EXISTS idx_symbol_regimes_regime
    ON symbol_regimes (regime, datetime DESC);

-- Public read, service-role write (matches market_regime_snapshots pattern)
ALTER TABLE symbol_regimes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "symbol_regimes_read"
    ON symbol_regimes FOR SELECT USING (true);

COMMENT ON TABLE symbol_regimes IS
    'Per-symbol per-timeframe regime classification (6 states). Updated daily by ETL. '
    'Distinct from market_regime_snapshots which is macro (VIX/SPY based, 3 states).';
