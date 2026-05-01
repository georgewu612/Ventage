"use client";

import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Crosshair,
  ExternalLink,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import Link from "next/link";

import { useI18n } from "@/lib/i18n/provider";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ScoredSignalDict {
  // Identity
  strategy_name: string;
  symbol: string;
  direction: "long" | "short";
  market_regime: string;

  // Trade plan
  entry_price: number;
  stop_price: number;
  target_1: number | null;
  target_2: number | null;
  trailing_rule: string | null;
  invalidation_reason: string;
  secondary_entry: boolean;

  // Tags + raw features
  pattern_tags: string[];
  raw_features: Record<string, unknown>;

  // Engine outputs
  volume_analysis: {
    volume_score: number;
    volume_state: string;
    volume_pattern_tag: string[];
    volume_warning: string[];
    volume_confirmed: boolean;
    relative_volume_20: number | null;
  };
  chip_analysis: {
    chip_score: number;
    cost_zone_position: string;
    overhead_supply_density: string;
    below_support_density: string;
    chip_migration_direction: string;
    profile_tag: string[];
    chip_warning: string[];
  };

  // Score
  score_market: number;
  score_position: number;
  score_pattern: number;
  score_volume: number;
  score_chip: number;
  score_rr: number;
  score_total: number;
  score_grade: "A" | "B" | "C" | null;
  score_breakdown: Record<
    string,
    { score: number; max: number; label: string }
  >;
}

// ── Localization ───────────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<string, { zh: string; en: string }> = {
  trend_pullback_breakout: {
    zh: "顺势回调突破",
    en: "Trend Pullback Breakout",
  },
  wyckoff_liquidity_sweep: { zh: "流动性扫荡", en: "Liquidity Sweep" },
  ema_squeeze_launch: { zh: "EMA 蓄势启动", en: "EMA Squeeze Launch" },
  bollinger_extreme_reversion: {
    zh: "布林极值回归",
    en: "BB Extreme Reversion",
  },
};

const REGIME_LABELS: Record<string, { zh: string; en: string }> = {
  strong_uptrend: { zh: "强趋势上涨", en: "Strong Uptrend" },
  strong_downtrend: { zh: "强趋势下跌", en: "Strong Downtrend" },
  squeeze_breakout_setup: { zh: "蓄势突破", en: "Squeeze Setup" },
  ranging: { zh: "区间震荡", en: "Ranging" },
  exhaustion_reversal: { zh: "趋势衰竭", en: "Exhaustion" },
  elevated_event_risk: { zh: "事件风险期", en: "Event Risk" },
};

const TAG_LABELS: Record<string, string> = {
  trend_continuation: "趋势延续",
  flag_breakout: "旗形突破",
  liquidity_sweep_long: "多头扫荡",
  liquidity_sweep_short: "空头扫荡",
  reversal_candle: "反转 K 线",
  oversold_bounce: "超卖反弹",
  overbought_rejection: "超买反压",
  ema_squeeze_breakout: "EMA 蓄势突破",
  above_all_emas: "站上三均线",
  first_buy_point: "第一买点",
  second_buy_point_pullback_to_ema34: "二买回踩 EMA34",
  bb_lower_extreme: "触及布林下轨",
  bb_upper_extreme: "触及布林上轨",
  bullish_reversal_candle: "看涨反转 K 线",
  bearish_reversal_candle: "看跌反转 K 线",
  stoch_oversold: "Stoch 超卖",
  stoch_overbought: "Stoch 超买",
  rsi_oversold: "RSI 超卖",
  rsi_overbought: "RSI 超买",
  sweep_with_volume: "扫荡放量",
  bullish_divergence_confirmation: "底部背离确认",
  bearish_divergence_confirmation: "顶部背离确认",
  macd_cross_up: "MACD 金叉",
  very_tight_squeeze: "极紧蓄势",
};

// ── Sub-components ─────────────────────────────────────────────────────────

function ScoreBar({
  label,
  score,
  max,
  tone = "cyan",
}: {
  label: string;
  score: number;
  max: number;
  tone?: "emerald" | "cyan" | "amber" | "red";
}) {
  const pct = Math.min(100, (score / max) * 100);
  const colorMap = {
    emerald: "bg-emerald-500",
    cyan: "bg-cyan-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
  } as const;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="text-gray-400">{label}</span>
        <span className="font-mono text-white tabular-nums">
          {score.toFixed(1)}
          <span className="text-gray-600">/{max}</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-700 ${colorMap[tone]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function GradeBadge({ grade }: { grade: "A" | "B" | "C" | null }) {
  if (!grade)
    return (
      <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-[10px] font-bold text-slate-400">
        —
      </span>
    );
  const cls = {
    A: "bg-emerald-500 text-white",
    B: "bg-amber-500 text-white",
    C: "bg-slate-500/40 text-slate-200",
  }[grade];
  return (
    <span
      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${cls}`}
    >
      {grade}
    </span>
  );
}

function PriceRow({
  label,
  price,
  tone,
  hint,
  icon: Icon,
}: {
  label: string;
  price: number | null;
  tone: "emerald" | "red" | "cyan" | "amber";
  hint?: string;
  icon?: React.ElementType;
}) {
  const colorMap = {
    emerald: "text-emerald-400",
    red: "text-red-400",
    cyan: "text-cyan-400",
    amber: "text-amber-400",
  };
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <div className="flex items-center gap-2">
        {Icon && <Icon className={`h-4 w-4 ${colorMap[tone]}`} />}
        <span className="text-xs text-gray-400">{label}</span>
        {hint && <span className="text-[10px] text-gray-600">{hint}</span>}
      </div>
      <span
        className={`font-mono text-sm font-bold tabular-nums ${colorMap[tone]}`}
      >
        ${price != null ? price.toFixed(2) : "—"}
      </span>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────

export function SignalDetailPanel({
  signal,
  compact = false,
}: {
  signal: ScoredSignalDict;
  compact?: boolean;
}) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const stratLabel = STRATEGY_LABELS[signal.strategy_name] ?? {
    zh: signal.strategy_name,
    en: signal.strategy_name,
  };
  const regimeLabel = REGIME_LABELS[signal.market_regime] ?? {
    zh: signal.market_regime,
    en: signal.market_regime,
  };

  const grade = signal.score_grade;
  const direction = signal.direction;
  const isLong = direction === "long";

  // Risk-reward calc
  const risk = isLong
    ? signal.entry_price - signal.stop_price
    : signal.stop_price - signal.entry_price;
  const reward1 =
    signal.target_1 != null
      ? isLong
        ? signal.target_1 - signal.entry_price
        : signal.entry_price - signal.target_1
      : 0;
  const reward2 =
    signal.target_2 != null
      ? isLong
        ? signal.target_2 - signal.entry_price
        : signal.entry_price - signal.target_2
      : 0;
  const riskPct = (risk / signal.entry_price) * 100;
  const rr1 = risk > 0 ? reward1 / risk : 0;
  const rr2 = risk > 0 ? reward2 / risk : 0;

  const cardBorder =
    grade === "A"
      ? "border-emerald-500/40 bg-gradient-to-br from-emerald-500/5 to-cyan-500/5"
      : grade === "B"
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-white/10 bg-white/5";

  const DirectionIcon = isLong ? TrendingUp : TrendingDown;

  return (
    <div className={`rounded-2xl border p-5 ${cardBorder}`}>
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <GradeBadge grade={grade} />
          <div>
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard/stocks/${signal.symbol}`}
                className="font-mono text-lg font-bold text-cyan-400 hover:underline"
              >
                {signal.symbol}
              </Link>
              <DirectionIcon
                className={`h-4 w-4 ${
                  isLong ? "text-emerald-400" : "text-red-400"
                }`}
              />
              <span
                className={`text-xs font-semibold ${
                  isLong ? "text-emerald-300" : "text-red-300"
                }`}
              >
                {isLong ? (isZh ? "做多" : "Long") : isZh ? "做空" : "Short"}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-gray-400">
              {isZh ? stratLabel.zh : stratLabel.en}
              <span className="mx-1.5 text-gray-600">·</span>
              <span className="text-gray-500">
                {isZh ? regimeLabel.zh : regimeLabel.en}
              </span>
            </p>
          </div>
        </div>
        {/* Big total score */}
        <div className="text-right">
          <p
            className={`text-3xl font-bold tabular-nums ${
              grade === "A"
                ? "text-emerald-400"
                : grade === "B"
                  ? "text-amber-400"
                  : "text-slate-400"
            }`}
          >
            {signal.score_total.toFixed(1)}
          </p>
          <p className="text-[10px] text-gray-500">
            {isZh ? "综合评分" : "score"} /100
          </p>
        </div>
      </div>

      {/* Trade plan */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <PriceRow
          label={isZh ? "入场价" : "Entry"}
          price={signal.entry_price}
          tone="cyan"
          icon={Crosshair}
        />
        <PriceRow
          label={isZh ? "止损" : "Stop"}
          price={signal.stop_price}
          tone="red"
          icon={Shield}
          hint={`${riskPct.toFixed(2)}%`}
        />
        <PriceRow
          label={isZh ? "目标 T1" : "Target 1"}
          price={signal.target_1}
          tone="emerald"
          icon={Target}
          hint={rr1 > 0 ? `${rr1.toFixed(1)}R` : undefined}
        />
        <PriceRow
          label={isZh ? "目标 T2" : "Target 2"}
          price={signal.target_2}
          tone="amber"
          icon={Target}
          hint={rr2 > 0 ? `${rr2.toFixed(1)}R` : undefined}
        />
      </div>

      {!compact && (
        <>
          {/* 6-dim score breakdown */}
          <div className="mb-4 space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="mb-1 text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
              {isZh ? "6 维评分细则" : "6-dim Score Breakdown"}
            </p>
            <ScoreBar
              label={isZh ? "市场状态" : "Regime Fit"}
              score={signal.score_market}
              max={20}
              tone="cyan"
            />
            <ScoreBar
              label={isZh ? "价格结构" : "Position Quality"}
              score={signal.score_position}
              max={20}
              tone="cyan"
            />
            <ScoreBar
              label={isZh ? "形态质量" : "Pattern"}
              score={signal.score_pattern}
              max={15}
              tone="amber"
            />
            <ScoreBar
              label={isZh ? "成交量" : "Volume"}
              score={signal.score_volume}
              max={20}
              tone="emerald"
            />
            <ScoreBar
              label={isZh ? "筹码结构" : "Chip"}
              score={signal.score_chip}
              max={15}
              tone="emerald"
            />
            <ScoreBar
              label={isZh ? "风报比" : "Risk/Reward"}
              score={signal.score_rr}
              max={10}
              tone="cyan"
            />
          </div>

          {/* Pattern tags */}
          {signal.pattern_tags.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold tracking-wider text-cyan-400 uppercase">
                <Zap className="h-3 w-3" />
                {isZh ? "策略形态标签" : "Pattern Tags"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {signal.pattern_tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-md bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-300"
                  >
                    {TAG_LABELS[t] ?? t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Volume / Chip rollup */}
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-emerald-400 uppercase">
                  {isZh ? "成交量" : "Volume"}
                </span>
                <span className="font-mono text-sm font-bold text-emerald-300 tabular-nums">
                  {signal.volume_analysis.volume_score.toFixed(0)}
                </span>
              </div>
              <p className="text-[10px] text-gray-500">
                {signal.volume_analysis.volume_state} ·{" "}
                {signal.volume_analysis.relative_volume_20?.toFixed(2) ?? "—"}×
              </p>
              <p
                className={`mt-1 text-[10px] font-semibold ${
                  signal.volume_analysis.volume_confirmed
                    ? "text-emerald-400"
                    : "text-amber-400"
                }`}
              >
                {signal.volume_analysis.volume_confirmed
                  ? isZh
                    ? "✓ 量能确认"
                    : "✓ Confirmed"
                  : isZh
                    ? "⚠ 未确认"
                    : "⚠ Unconfirmed"}
              </p>
            </div>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-amber-400 uppercase">
                  {isZh ? "筹码结构" : "Chip"}
                </span>
                <span className="font-mono text-sm font-bold text-amber-300 tabular-nums">
                  {signal.chip_analysis.chip_score.toFixed(0)}
                </span>
              </div>
              <p className="text-[10px] text-gray-500">
                {signal.chip_analysis.cost_zone_position}
              </p>
              <p className="mt-1 text-[10px] text-gray-500">
                {isZh ? "迁移" : "Mig"}:{" "}
                <span
                  className={
                    signal.chip_analysis.chip_migration_direction === "rising"
                      ? "text-emerald-300"
                      : signal.chip_analysis.chip_migration_direction ===
                          "falling"
                        ? "text-red-300"
                        : "text-slate-300"
                  }
                >
                  {signal.chip_analysis.chip_migration_direction}
                </span>
              </p>
            </div>
          </div>

          {/* Invalidation */}
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-400" />
            <div className="text-[11px]">
              <p className="mb-0.5 font-semibold text-orange-300">
                {isZh ? "失效条件" : "Invalidation"}
              </p>
              <p className="text-gray-400">{signal.invalidation_reason}</p>
              {signal.trailing_rule && (
                <p className="mt-1 text-gray-500">
                  {isZh ? "跟踪止损：" : "Trailing: "}
                  <span className="font-mono text-cyan-300">
                    {signal.trailing_rule}
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* Workbench link */}
          <Link
            href={`/dashboard/stocks/${signal.symbol}`}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-medium text-cyan-300 transition-colors hover:bg-white/10"
          >
            <ExternalLink className="h-3 w-3" />
            {isZh ? "在工作台查看完整分析" : "Open Workbench"}
          </Link>
        </>
      )}
    </div>
  );
}
