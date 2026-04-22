-- Execution layer: paper trading orders table — Phase 4

CREATE TABLE IF NOT EXISTS paper_orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  symbol       TEXT NOT NULL,
  side         TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  order_type   TEXT NOT NULL CHECK (order_type IN ('market', 'limit', 'stop')),
  quantity     NUMERIC NOT NULL,
  limit_price  NUMERIC,
  stop_price   NUMERIC,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'filled', 'cancelled', 'rejected')),
  fill_price   NUMERIC,
  filled_at    TIMESTAMPTZ,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE paper_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paper_orders_self" ON paper_orders FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_paper_orders_user ON paper_orders (user_id, created_at DESC);
