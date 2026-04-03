-- Alert history table for deduplication
CREATE TABLE IF NOT EXISTS alert_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    symbol TEXT NOT NULL,
    module TEXT NOT NULL,
    signal_score NUMERIC,
    direction TEXT,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    channel TEXT DEFAULT 'telegram'
);

-- Enable RLS
ALTER TABLE alert_history ENABLE ROW LEVEL SECURITY;

-- Read access for authenticated users
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'alert_history_read' AND tablename = 'alert_history') THEN
    CREATE POLICY "alert_history_read" ON alert_history FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'alert_history_service_write' AND tablename = 'alert_history') THEN
    CREATE POLICY "alert_history_service_write" ON alert_history FOR INSERT TO service_role WITH CHECK (true);
  END IF;
END $$;

-- Index for dedup lookups
CREATE INDEX IF NOT EXISTS idx_alert_history_dedup
    ON alert_history (symbol, module, sent_at DESC);
