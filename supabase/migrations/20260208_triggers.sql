-- ================================================
-- Triggers and Functions
-- Version: 1.0
-- Date: 2026-02-08
-- ================================================

-- Insider trade alert trigger function
CREATE OR REPLACE FUNCTION notify_large_insider_trade()
RETURNS TRIGGER AS $$
BEGIN
    -- Large buy alert (> $100,000)
    IF NEW.trade_type = 'BUY' AND NEW.value > 100000 THEN
        PERFORM pg_notify('insider_alert', json_build_object(
            'type', 'large_buy',
            'symbol', NEW.symbol,
            'insider', NEW.insider_name,
            'title', NEW.insider_title,
            'value', NEW.value,
            'shares', NEW.shares
        )::text);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on insider_trades table
DROP TRIGGER IF EXISTS insider_trade_alert_trigger ON insider_trades;
CREATE TRIGGER insider_trade_alert_trigger
AFTER INSERT ON insider_trades
FOR EACH ROW EXECUTE FUNCTION notify_large_insider_trade();
