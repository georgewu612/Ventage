-- Add indexes for query performance
-- Based on actual query patterns from API routes

-- ============================================================
-- market_signals 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_market_signals_symbol_created
    ON market_signals (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_signals_created
    ON market_signals (created_at DESC);

-- ============================================================
-- options_flow 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_options_flow_symbol_created
    ON options_flow (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_options_flow_type_created
    ON options_flow (option_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_options_flow_created
    ON options_flow (created_at DESC);

-- ============================================================
-- insider_trades 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_insider_trades_symbol_filing
    ON insider_trades (symbol, filing_date DESC);

CREATE INDEX IF NOT EXISTS idx_insider_trades_type_filing
    ON insider_trades (trade_type, filing_date DESC);

CREATE INDEX IF NOT EXISTS idx_insider_trades_filing
    ON insider_trades (filing_date DESC);

-- ============================================================
-- market_sentiment 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_market_sentiment_symbol_created
    ON market_sentiment (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_sentiment_source_created
    ON market_sentiment (source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_sentiment_created
    ON market_sentiment (created_at DESC);

-- ============================================================
-- dark_pool_orders 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_dark_pool_symbol_created
    ON dark_pool_orders (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dark_pool_trade_time
    ON dark_pool_orders (trade_time DESC);

-- ============================================================
-- earnings_forecasts 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_earnings_symbol_report
    ON earnings_forecasts (symbol, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_earnings_report_date
    ON earnings_forecasts (report_date DESC);

-- ============================================================
-- put_call_ratios 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_pcr_symbol_date
    ON put_call_ratios (symbol, date DESC);

CREATE INDEX IF NOT EXISTS idx_pcr_date
    ON put_call_ratios (date DESC);
