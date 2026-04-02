-- Baseline migration: Records existing table schema
-- These tables were created manually in Supabase before migration tracking began.
-- This file documents the initial schema for version control.

-- ============================================================
-- 1. market_signals — AI 生成的市场信号
-- ============================================================
CREATE TABLE IF NOT EXISTS market_signals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol          VARCHAR NOT NULL,
    signal_type     VARCHAR NOT NULL,        -- technical, fundamental, sentiment, composite
    direction       VARCHAR NOT NULL,        -- bullish, bearish, neutral
    confidence      NUMERIC NOT NULL,        -- 0.0 ~ 1.0
    analysis        TEXT,                    -- 分析摘要
    factors         JSONB,                   -- 嵌套因子数据 (module, signal_score, etc.)
    valid_until     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. options_flow — 期权异动数据
-- ============================================================
CREATE TABLE IF NOT EXISTS options_flow (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol              VARCHAR NOT NULL,
    option_type         VARCHAR NOT NULL,    -- call, put
    strike              NUMERIC NOT NULL,
    expiration          DATE NOT NULL,
    premium             NUMERIC NOT NULL,
    volume              INTEGER NOT NULL,
    open_interest       INTEGER,
    implied_volatility  NUMERIC,
    unusual_score       NUMERIC,             -- 20~99, 越高越异常
    trade_type          VARCHAR,             -- sweep, block, split
    sentiment           VARCHAR,             -- bullish, bearish
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. insider_trades — 内部人交易
-- ============================================================
CREATE TABLE IF NOT EXISTS insider_trades (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol              VARCHAR NOT NULL,
    insider_name        VARCHAR NOT NULL,
    insider_title       VARCHAR,             -- CEO, CFO, CTO, Director, VP
    relationship        VARCHAR,             -- Officer, Director, 10% Owner
    trade_type          VARCHAR NOT NULL,    -- BUY, SELL
    shares              INTEGER NOT NULL,
    price               NUMERIC,
    value               NUMERIC,
    shares_owned_after  INTEGER,
    filing_date         DATE NOT NULL,
    transaction_date    DATE,
    sec_form            VARCHAR,             -- Form 4
    footnotes           TEXT,
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 4. market_sentiment — 市场情绪分析
-- ============================================================
CREATE TABLE IF NOT EXISTS market_sentiment (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol            VARCHAR NOT NULL,
    source            VARCHAR NOT NULL,      -- reddit, twitter, news
    sentiment_score   NUMERIC,               -- -1.0 ~ 1.0
    magnitude         NUMERIC,
    volume            INTEGER,               -- 提及数量
    keywords          JSONB,                 -- {bullish: N, bearish: N}
    sample_posts      JSONB,
    analysis_window   VARCHAR,               -- 1h, 24h, 7d
    created_at        TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 5. dark_pool_orders — 暗池订单
-- ============================================================
CREATE TABLE IF NOT EXISTS dark_pool_orders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol      VARCHAR NOT NULL,
    price       NUMERIC NOT NULL,
    size        INTEGER NOT NULL,
    exchange    VARCHAR,
    trade_time  TIMESTAMPTZ,
    value       NUMERIC GENERATED ALWAYS AS (price * size) STORED,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 6. earnings_forecasts — 财报预测
-- ============================================================
CREATE TABLE IF NOT EXISTS earnings_forecasts (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol                  VARCHAR NOT NULL,
    report_date             DATE NOT NULL,
    fiscal_quarter          VARCHAR,
    predicted_eps           NUMERIC,
    actual_eps              NUMERIC,
    consensus_eps           NUMERIC,
    predicted_revenue       NUMERIC,
    actual_revenue          NUMERIC,
    consensus_revenue       NUMERIC,
    surprise_pct            NUMERIC,
    prediction_confidence   NUMERIC,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 7. put_call_ratios — 看跌/看涨比率
-- ============================================================
CREATE TABLE IF NOT EXISTS put_call_ratios (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol      VARCHAR,
    ratio       NUMERIC NOT NULL,
    put_volume  INTEGER NOT NULL,
    call_volume INTEGER NOT NULL,
    date        DATE NOT NULL,
    ratio_type  VARCHAR,
    percentile  NUMERIC,
    created_at  TIMESTAMPTZ DEFAULT now()
);
