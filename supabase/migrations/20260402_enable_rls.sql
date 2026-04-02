-- Enable Row Level Security on all tables and create access policies
-- Policy: anon/authenticated users can READ, service_role can do everything

-- ============================================================
-- Enable RLS
-- ============================================================
ALTER TABLE market_signals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE options_flow      ENABLE ROW LEVEL SECURITY;
ALTER TABLE insider_trades    ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_sentiment  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dark_pool_orders  ENABLE ROW LEVEL SECURITY;
ALTER TABLE earnings_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE put_call_ratios   ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Read policies — anon 和 authenticated 用户可以读取
-- ============================================================
CREATE POLICY "Allow public read access"
    ON market_signals FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Allow public read access"
    ON options_flow FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Allow public read access"
    ON insider_trades FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Allow public read access"
    ON market_sentiment FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Allow public read access"
    ON dark_pool_orders FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Allow public read access"
    ON earnings_forecasts FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Allow public read access"
    ON put_call_ratios FOR SELECT
    TO anon, authenticated
    USING (true);

-- ============================================================
-- Write policies — 仅 service_role 可以写入（ETL 管道使用）
-- ============================================================
CREATE POLICY "Allow service role insert"
    ON market_signals FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Allow service role update"
    ON market_signals FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role delete"
    ON market_signals FOR DELETE
    TO service_role
    USING (true);

CREATE POLICY "Allow service role insert"
    ON options_flow FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Allow service role update"
    ON options_flow FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role delete"
    ON options_flow FOR DELETE
    TO service_role
    USING (true);

CREATE POLICY "Allow service role insert"
    ON insider_trades FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Allow service role update"
    ON insider_trades FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role delete"
    ON insider_trades FOR DELETE
    TO service_role
    USING (true);

CREATE POLICY "Allow service role insert"
    ON market_sentiment FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Allow service role update"
    ON market_sentiment FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role delete"
    ON market_sentiment FOR DELETE
    TO service_role
    USING (true);

CREATE POLICY "Allow service role insert"
    ON dark_pool_orders FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Allow service role update"
    ON dark_pool_orders FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role delete"
    ON dark_pool_orders FOR DELETE
    TO service_role
    USING (true);

CREATE POLICY "Allow service role insert"
    ON earnings_forecasts FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Allow service role update"
    ON earnings_forecasts FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role delete"
    ON earnings_forecasts FOR DELETE
    TO service_role
    USING (true);

CREATE POLICY "Allow service role insert"
    ON put_call_ratios FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Allow service role update"
    ON put_call_ratios FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role delete"
    ON put_call_ratios FOR DELETE
    TO service_role
    USING (true);
