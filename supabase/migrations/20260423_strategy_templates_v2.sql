-- ============================================================
-- Strategy Templates v2 — 新增第 5、6 个策略模板
-- 现有 4 个：SMA Crossover / RSI Mean Reversion / Bollinger Band / MACD
-- 新增 2 个：Momentum Breakout / Low Volatility Defense
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM strategy_templates WHERE name = 'Momentum Breakout') THEN
    INSERT INTO strategy_templates (name, name_zh, description, category, params_schema, default_params)
    VALUES (
      'Momentum Breakout',
      '动量突破',
      'Buy stocks breaking out above their 52-week high on above-average volume; ride the momentum until trend weakens.',
      'momentum',
      '{"lookback": {"type": "int", "min": 200, "max": 260, "step": 10, "label": "突破周期(交易日)"}, "volume_mult": {"type": "float", "min": 1.5, "max": 3.0, "step": 0.5, "label": "成交量倍数"}}',
      '{"lookback": 252, "volume_mult": 2.0}'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM strategy_templates WHERE name = 'Low Volatility Defense') THEN
    INSERT INTO strategy_templates (name, name_zh, description, category, params_schema, default_params)
    VALUES (
      'Low Volatility Defense',
      '低波防守',
      'Rotate into low-beta, low-volatility stocks during elevated VIX regimes to preserve capital and reduce drawdown.',
      'volatility',
      '{"vix_threshold": {"type": "float", "min": 18, "max": 28, "step": 1, "label": "VIX 触发阈值"}, "beta_max": {"type": "float", "min": 0.5, "max": 1.0, "step": 0.1, "label": "最大 Beta 上限"}}',
      '{"vix_threshold": 22, "beta_max": 0.8}'
    );
  END IF;
END $$;
