-- ============================================================
-- Market Regime Snapshots
-- 每日存储市场环境快照，供 Dashboard Market Pulse 区域展示
-- ============================================================

CREATE TABLE IF NOT EXISTS market_regime_snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 核心判断
  regime           TEXT NOT NULL CHECK (regime IN ('risk_on', 'neutral', 'risk_off')),
  volatility       TEXT NOT NULL CHECK (volatility IN ('low', 'normal', 'high', 'very_high')),
  breadth          TEXT NOT NULL CHECK (breadth IN ('healthy', 'narrow', 'weak')),
  style            TEXT NOT NULL CHECK (style IN ('growth', 'value', 'defensive', 'cyclical', 'mixed')),
  recommendation   TEXT NOT NULL CHECK (recommendation IN ('offense', 'neutral', 'defense')),
  confidence       NUMERIC(4,2) NOT NULL DEFAULT 0.70,
  -- 原始指标（供前端展示）
  vix              NUMERIC(6,2),
  spy_vs_200ma_pct NUMERIC(6,2),   -- SPY 相对 200 日均线百分比
  rsp_spy_ratio    NUMERIC(8,4),   -- 等权/市值权重比（市场宽度）
  qqq_iwm_ratio    NUMERIC(8,4),   -- 成长/价值比
  put_call_ratio   NUMERIC(6,3),   -- 期权 P/C 比率
  -- AI Chief Strategist 摘要
  chief_summary    TEXT,
  chief_summary_en TEXT,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regime_generated
  ON market_regime_snapshots(generated_at DESC);

-- 所有会员公开只读
ALTER TABLE market_regime_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "regime_read_all" ON market_regime_snapshots
  FOR SELECT USING (true);
