// Feature gate definitions — maps feature keys to the minimum plan required

export type Plan = "free" | "pro" | "premium";

export const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  pro: 1,
  premium: 2,
};

/** Which plan is the minimum requirement for each feature */
export const FEATURE_PLAN_MAP: Record<string, Plan> = {
  // ── Free ──────────────────────────────────────────────────
  market_radar: "free",
  news: "free",
  basic_signals: "free",

  // ── Pro ───────────────────────────────────────────────────
  options_flow: "pro",
  insider_trades: "pro",
  dark_pool: "pro",
  sentiment: "pro",
  technical: "pro",
  ai_reports: "pro",
  stock_workbench: "pro",
  alerts: "pro",
  watchlist: "pro",
  signal_detail: "pro",

  // ── Premium ───────────────────────────────────────────────
  quant_lab: "premium",
  backtest: "premium",
  factor_studio: "premium",
  strategy_copilot: "premium",
  portfolio: "premium",
  portfolio_builder: "premium",
  execution: "premium",
  multi_agent: "premium",
  admin: "premium",
};

/**
 * Returns true if userPlan meets the minimum requirement for the feature.
 * Unknown features are always accessible.
 */
export function hasAccess(userPlan: string, feature: string): boolean {
  const required = FEATURE_PLAN_MAP[feature];
  if (!required) return true;
  const userRank = PLAN_RANK[userPlan as Plan] ?? 0;
  const requiredRank = PLAN_RANK[required] ?? 0;
  return userRank >= requiredRank;
}

/** Human-readable plan label */
export const PLAN_LABELS: Record<
  Plan,
  { zh: string; en: string; color: string }
> = {
  free: { zh: "免费版", en: "Free", color: "text-gray-400 bg-gray-500/15" },
  pro: { zh: "专业版", en: "Pro", color: "text-cyan-300 bg-cyan-500/15" },
  premium: {
    zh: "旗舰版",
    en: "Premium",
    color: "text-amber-300 bg-amber-500/15",
  },
};
