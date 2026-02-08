-- ================================================
-- Ventage Database Schema Migration
-- Version: 1.0
-- Date: 2026-02-08
-- ================================================

-- 1. AI 市场信号
CREATE TABLE IF NOT EXISTS market_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(10) NOT NULL,
    signal_type VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL,
    confidence DECIMAL(5,4) NOT NULL,
    analysis TEXT,
    factors JSONB,
    valid_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_symbol ON market_signals(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_confidence ON market_signals(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_signals_created ON market_signals(created_at DESC);

-- 2. 期权异动
CREATE TABLE IF NOT EXISTS options_flow (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(10) NOT NULL,
    option_type VARCHAR(4) NOT NULL,
    strike DECIMAL(12,2) NOT NULL,
    expiration DATE NOT NULL,
    premium DECIMAL(15,2) NOT NULL,
    volume INTEGER NOT NULL,
    open_interest INTEGER,
    implied_volatility DECIMAL(6,4),
    unusual_score DECIMAL(5,2),
    trade_type VARCHAR(20),
    sentiment VARCHAR(10),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_options_symbol ON options_flow(symbol);
CREATE INDEX IF NOT EXISTS idx_options_premium ON options_flow(premium DESC);
CREATE INDEX IF NOT EXISTS idx_options_created ON options_flow(created_at DESC);

-- 3. Dark Pool 订单
CREATE TABLE IF NOT EXISTS dark_pool_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(10) NOT NULL,
    price DECIMAL(12,4) NOT NULL,
    size INTEGER NOT NULL,
    value DECIMAL(15,2) GENERATED ALWAYS AS (price * size) STORED,
    exchange VARCHAR(20),
    trade_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_darkpool_symbol ON dark_pool_orders(symbol);
CREATE INDEX IF NOT EXISTS idx_darkpool_value ON dark_pool_orders(value DESC);
CREATE INDEX IF NOT EXISTS idx_darkpool_created ON dark_pool_orders(created_at DESC);

-- 4. 财报预测
CREATE TABLE IF NOT EXISTS earnings_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(10) NOT NULL,
    report_date DATE NOT NULL,
    fiscal_quarter VARCHAR(10),
    predicted_eps DECIMAL(10,4),
    actual_eps DECIMAL(10,4),
    consensus_eps DECIMAL(10,4),
    predicted_revenue DECIMAL(15,2),
    actual_revenue DECIMAL(15,2),
    consensus_revenue DECIMAL(15,2),
    surprise_pct DECIMAL(8,4),
    prediction_confidence DECIMAL(5,4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_earnings_symbol_date ON earnings_forecasts(symbol, report_date);

-- 5. 市场情绪
CREATE TABLE IF NOT EXISTS market_sentiment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(10) NOT NULL,
    source VARCHAR(20) NOT NULL,
    sentiment_score DECIMAL(5,4),
    magnitude DECIMAL(5,4),
    volume INTEGER,
    keywords JSONB,
    sample_posts JSONB,
    analysis_window VARCHAR(10),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sentiment_symbol ON market_sentiment(symbol);
CREATE INDEX IF NOT EXISTS idx_sentiment_source ON market_sentiment(source);
CREATE INDEX IF NOT EXISTS idx_sentiment_created ON market_sentiment(created_at DESC);

-- 6. 内部交易
CREATE TABLE IF NOT EXISTS insider_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(10) NOT NULL,
    insider_name VARCHAR(100) NOT NULL,
    insider_title VARCHAR(100),
    relationship VARCHAR(50),
    trade_type VARCHAR(10) NOT NULL,
    shares INTEGER NOT NULL,
    price DECIMAL(12,4),
    value DECIMAL(15,2),
    shares_owned_after INTEGER,
    filing_date DATE NOT NULL,
    transaction_date DATE,
    sec_form VARCHAR(10),
    footnotes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insider_symbol ON insider_trades(symbol);
CREATE INDEX IF NOT EXISTS idx_insider_type ON insider_trades(trade_type);
CREATE INDEX IF NOT EXISTS idx_insider_value ON insider_trades(value DESC);
CREATE INDEX IF NOT EXISTS idx_insider_date ON insider_trades(filing_date DESC);

-- 7. Put/Call 比率
CREATE TABLE IF NOT EXISTS put_call_ratios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(10),
    ratio DECIMAL(6,4) NOT NULL,
    put_volume INTEGER NOT NULL,
    call_volume INTEGER NOT NULL,
    date DATE NOT NULL,
    ratio_type VARCHAR(20),
    percentile DECIMAL(5,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pcr_symbol_date ON put_call_ratios(symbol, date);
