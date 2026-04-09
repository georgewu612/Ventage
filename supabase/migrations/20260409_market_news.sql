-- Market news table for WallStreetCN live feed and future news sources
-- Stores real-time financial news/flash updates

CREATE TABLE IF NOT EXISTS market_news (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          VARCHAR NOT NULL DEFAULT 'wallstreetcn',   -- wallstreetcn, financialjuice, etc.
    source_id       VARCHAR NOT NULL,                          -- original ID from the source
    title           TEXT,                                      -- headline (can be empty for flash updates)
    content         TEXT NOT NULL,                             -- plain text content
    channels        JSONB DEFAULT '[]',                        -- e.g. ["global-channel", "us-stock-channel"]
    importance      INTEGER DEFAULT 1,                         -- importance score (1=normal, 2+=important)
    symbols         JSONB DEFAULT '[]',                        -- related stock symbols extracted
    published_at    TIMESTAMPTZ NOT NULL,                      -- original publish time
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(source, source_id)                                  -- prevent duplicates
);

CREATE INDEX IF NOT EXISTS idx_market_news_published
    ON market_news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_news_source
    ON market_news(source, published_at DESC);

-- RLS
ALTER TABLE market_news ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access on market_news"
    ON market_news FOR SELECT
    USING (true);

CREATE POLICY "Allow service role full access on market_news"
    ON market_news FOR ALL
    USING (auth.role() = 'service_role');
