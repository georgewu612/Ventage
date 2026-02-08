-- ================================================
-- Row Level Security (RLS) Policies
-- Version: 1.0
-- Date: 2026-02-08
-- ================================================

-- Enable RLS on all tables
ALTER TABLE market_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE options_flow ENABLE ROW LEVEL SECURITY;
ALTER TABLE dark_pool_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE earnings_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_sentiment ENABLE ROW LEVEL SECURITY;
ALTER TABLE insider_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE put_call_ratios ENABLE ROW LEVEL SECURITY;

-- ================================================
-- Read Policies: Authenticated users can read
-- ================================================

CREATE POLICY "Authenticated users can read market_signals" ON market_signals
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read options_flow" ON options_flow
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read dark_pool_orders" ON dark_pool_orders
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read earnings_forecasts" ON earnings_forecasts
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read market_sentiment" ON market_sentiment
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read insider_trades" ON insider_trades
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read put_call_ratios" ON put_call_ratios
    FOR SELECT USING (auth.role() = 'authenticated');

-- ================================================
-- Write Policies: Service role can write
-- ================================================

CREATE POLICY "Service role can insert market_signals" ON market_signals
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can insert options_flow" ON options_flow
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can insert dark_pool_orders" ON dark_pool_orders
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can insert earnings_forecasts" ON earnings_forecasts
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can update earnings_forecasts" ON earnings_forecasts
    FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "Service role can insert market_sentiment" ON market_sentiment
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can insert insider_trades" ON insider_trades
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can insert put_call_ratios" ON put_call_ratios
    FOR INSERT WITH CHECK (auth.role() = 'service_role');
