"use client";

import type { MarketRegime } from "@/lib/hooks/useMarketRegime";
import { useI18n } from "@/lib/i18n/provider";

interface RegimeBadgeProps {
  regime: MarketRegime;
  compact?: boolean;
}

const REGIME_CONFIG = {
  risk_on: {
    bg: "bg-emerald-500/20",
    border: "border-emerald-500/40",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
    labelKey: "regime.riskOn" as const,
  },
  neutral: {
    bg: "bg-yellow-500/20",
    border: "border-yellow-500/40",
    text: "text-yellow-400",
    dot: "bg-yellow-400",
    labelKey: "regime.neutral" as const,
  },
  risk_off: {
    bg: "bg-red-500/20",
    border: "border-red-500/40",
    text: "text-red-400",
    dot: "bg-red-400",
    labelKey: "regime.riskOff" as const,
  },
} as const;

const VOL_LABEL: Record<MarketRegime["volatility"], string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  very_high: "Very High",
};

const REC_CONFIG: Record<
  MarketRegime["recommendation"],
  { text: string; color: string }
> = {
  offense: { text: "Offense", color: "text-emerald-400" },
  neutral: { text: "Neutral", color: "text-yellow-400" },
  defense: { text: "Defense", color: "text-red-400" },
};

export function RegimeBadge({ regime, compact = false }: RegimeBadgeProps) {
  const { t } = useI18n();
  const cfg = REGIME_CONFIG[regime.regime];
  const rec = REC_CONFIG[regime.recommendation];

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${cfg.bg} ${cfg.border} ${cfg.text}`}
      >
        <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
        {t(cfg.labelKey)}
        {regime.vix != null && (
          <span className="ml-1 opacity-70">VIX {regime.vix.toFixed(1)}</span>
        )}
      </span>
    );
  }

  return (
    <div className={`rounded-xl border p-4 ${cfg.bg} ${cfg.border} space-y-3`}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div
          className={`flex items-center gap-2 text-lg font-bold ${cfg.text}`}
        >
          <span className={`h-3 w-3 rounded-full ${cfg.dot} animate-pulse`} />
          {t(cfg.labelKey)}
        </div>
        <span className="text-xs text-slate-400">
          {t("regime.confidence")} {Math.round(regime.confidence * 100)}%
        </span>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {regime.vix != null && (
          <Metric label="VIX" value={regime.vix.toFixed(1)} />
        )}
        {regime.spy_vs_200ma_pct != null && (
          <Metric
            label="SPY vs 200MA"
            value={`${regime.spy_vs_200ma_pct > 0 ? "+" : ""}${regime.spy_vs_200ma_pct.toFixed(1)}%`}
            positive={regime.spy_vs_200ma_pct > 0}
          />
        )}
        <Metric
          label={t("regime.volatility")}
          value={VOL_LABEL[regime.volatility]}
        />
        <Metric
          label={t("regime.recommendation")}
          value={rec.text}
          customColor={rec.color}
        />
      </div>

      {/* Chief summary */}
      <p className="text-sm leading-relaxed text-slate-300">
        {regime.chief_summary_en}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  positive,
  customColor,
}: {
  label: string;
  value: string;
  positive?: boolean;
  customColor?: string;
}) {
  const valueColor =
    customColor ??
    (positive === undefined
      ? "text-white"
      : positive
        ? "text-emerald-400"
        : "text-red-400");

  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <div className="mb-0.5 text-xs text-slate-400">{label}</div>
      <div className={`text-sm font-semibold ${valueColor}`}>{value}</div>
    </div>
  );
}
