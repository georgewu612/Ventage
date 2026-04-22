-- Quant Lab: strategy templates, backtest runs, factor definitions
-- Phase 2 migration

-- ── 1. Strategy Templates（系统级，非用户私有）─────────────────────────
CREATE TABLE IF NOT EXISTS strategy_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  name_zh     TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL DEFAULT 'trend',   -- trend | mean_reversion | momentum | volatility
  params_schema JSONB NOT NULL DEFAULT '{}',   -- JSON Schema for the params UI
  default_params JSONB NOT NULL DEFAULT '{}',  -- sane defaults
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Strategy Runs（用户每次回测记录）────────────────────────────────
CREATE TABLE IF NOT EXISTS strategy_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  template_id  UUID REFERENCES strategy_templates(id),
  template_name TEXT NOT NULL,
  symbol       TEXT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  params       JSONB NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'pending'  -- pending | running | done | failed
               CHECK (status IN ('pending','running','done','failed')),
  error_msg    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);

-- ── 3. Backtest Results（回测结果摘要）────────────────────────────────
CREATE TABLE IF NOT EXISTS backtest_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES strategy_runs(id) ON DELETE CASCADE,
  total_return    NUMERIC,    -- e.g. 0.35 = 35%
  annualized_return NUMERIC,
  sharpe_ratio    NUMERIC,
  max_drawdown    NUMERIC,    -- positive value, e.g. 0.15 = 15%
  win_rate        NUMERIC,
  total_trades    INT,
  profit_factor   NUMERIC,
  equity_curve    JSONB,      -- [{date, value}]
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. Backtest Trades（逐笔交易明细）────────────────────────────────
CREATE TABLE IF NOT EXISTS backtest_trades (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id    UUID NOT NULL REFERENCES strategy_runs(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  exit_date  DATE,
  side       TEXT NOT NULL DEFAULT 'long' CHECK (side IN ('long','short')),
  entry_price NUMERIC,
  exit_price  NUMERIC,
  quantity    NUMERIC,
  pnl         NUMERIC,
  pnl_pct     NUMERIC,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. Factor Definitions（因子库定义）───────────────────────────────
CREATE TABLE IF NOT EXISTS factor_definitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  name_zh     TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL DEFAULT 'technical',  -- technical | fundamental | sentiment | custom
  formula     TEXT,
  params      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. Optimization Runs（参数优化记录）──────────────────────────────
CREATE TABLE IF NOT EXISTS optimization_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  run_id       UUID REFERENCES strategy_runs(id) ON DELETE SET NULL,
  method       TEXT NOT NULL DEFAULT 'grid',   -- grid | random | bayesian
  param_grid   JSONB NOT NULL DEFAULT '{}',
  best_params  JSONB,
  best_sharpe  NUMERIC,
  all_results  JSONB,                          -- [{params, sharpe, return, ...}]
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE strategy_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_results    ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_trades     ENABLE ROW LEVEL SECURITY;
ALTER TABLE factor_definitions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE optimization_runs   ENABLE ROW LEVEL SECURITY;

-- strategy_templates: 所有登录用户可读
CREATE POLICY "templates_read" ON strategy_templates FOR SELECT USING (auth.uid() IS NOT NULL);

-- factor_definitions: 所有登录用户可读
CREATE POLICY "factors_read" ON factor_definitions FOR SELECT USING (auth.uid() IS NOT NULL);

-- strategy_runs: 用户只能读写自己的
CREATE POLICY "runs_self" ON strategy_runs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- backtest_results / trades: 通过 run_id 关联到用户
CREATE POLICY "results_self" ON backtest_results FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM strategy_runs r
    WHERE r.id = run_id AND r.user_id = auth.uid()
  ));

CREATE POLICY "trades_self" ON backtest_trades FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM strategy_runs r
    WHERE r.id = run_id AND r.user_id = auth.uid()
  ));

-- optimization_runs: 用户只能读写自己的
CREATE POLICY "optim_self" ON optimization_runs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Indexes ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_strategy_runs_user ON strategy_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_results_run ON backtest_results (run_id);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_run ON backtest_trades (run_id);
CREATE INDEX IF NOT EXISTS idx_optimization_runs_user ON optimization_runs (user_id, created_at DESC);

-- ── Seed: Built-in Strategy Templates ────────────────────────────────
INSERT INTO strategy_templates (name, name_zh, description, category, params_schema, default_params)
VALUES
  (
    'sma_crossover',
    'SMA 金叉死叉',
    '双均线交叉策略：快线上穿慢线做多，下穿做空。经典趋势跟踪。',
    'trend',
    '{
      "type": "object",
      "properties": {
        "fast_period": {"type": "integer", "minimum": 5, "maximum": 50, "title": "快线周期"},
        "slow_period": {"type": "integer", "minimum": 20, "maximum": 200, "title": "慢线周期"}
      }
    }',
    '{"fast_period": 10, "slow_period": 30}'
  ),
  (
    'rsi_mean_reversion',
    'RSI 均值回归',
    'RSI 超卖买入（RSI<30），超买卖出（RSI>70）。适合震荡行情。',
    'mean_reversion',
    '{
      "type": "object",
      "properties": {
        "rsi_period": {"type": "integer", "minimum": 5, "maximum": 30, "title": "RSI 周期"},
        "oversold": {"type": "integer", "minimum": 10, "maximum": 40, "title": "超卖阈值"},
        "overbought": {"type": "integer", "minimum": 60, "maximum": 90, "title": "超买阈值"}
      }
    }',
    '{"rsi_period": 14, "oversold": 30, "overbought": 70}'
  ),
  (
    'bollinger_band',
    '布林带突破',
    '价格突破布林带上轨做多，跌破下轨做空。捕捉突破行情。',
    'momentum',
    '{
      "type": "object",
      "properties": {
        "period": {"type": "integer", "minimum": 10, "maximum": 50, "title": "均线周期"},
        "std_dev": {"type": "number", "minimum": 1.0, "maximum": 3.0, "title": "标准差倍数"}
      }
    }',
    '{"period": 20, "std_dev": 2.0}'
  ),
  (
    'macd_signal',
    'MACD 信号线交叉',
    'MACD 线上穿信号线做多，下穿做空。趋势确认 + 动量结合。',
    'momentum',
    '{
      "type": "object",
      "properties": {
        "fast_period": {"type": "integer", "minimum": 5, "maximum": 20, "title": "快线周期"},
        "slow_period": {"type": "integer", "minimum": 15, "maximum": 40, "title": "慢线周期"},
        "signal_period": {"type": "integer", "minimum": 5, "maximum": 15, "title": "信号线周期"}
      }
    }',
    '{"fast_period": 12, "slow_period": 26, "signal_period": 9}'
  )
ON CONFLICT DO NOTHING;

-- ── Seed: Built-in Factor Definitions ────────────────────────────────
INSERT INTO factor_definitions (name, name_zh, description, category)
VALUES
  ('rsi_14', 'RSI(14)', '14日相对强弱指数，衡量价格动量', 'technical'),
  ('sma_20_50_cross', 'SMA 20/50 金叉', '20日均线与50日均线的距离百分比', 'technical'),
  ('volume_ratio', '量比', '当日成交量 / 过去20日平均量', 'technical'),
  ('price_momentum_20', '20日价格动量', '过去20个交易日的收益率', 'technical'),
  ('volatility_20', '20日波动率', '过去20日日收益率的标准差（年化）', 'technical'),
  ('bb_position', '布林带位置', '价格在布林带中的相对位置 0-1', 'technical')
ON CONFLICT DO NOTHING;
