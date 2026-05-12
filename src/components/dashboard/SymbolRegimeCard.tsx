"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Loader2,
  TrendingDown,
  TrendingUp,
  Minus,
  Zap,
  Target,
} from "lucide-react";

import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";

interface RegimeData {
  symbol: string;
  timeframe: string;
  datetime: string;
  regime:
    | "strong_uptrend"
    | "strong_downtrend"
    | "squeeze_breakout_setup"
    | "ranging"
    | "exhaustion_reversal"
    | "elevated_event_risk";
  regime_score: number;
  adx: number | null;
  ema_alignment: "bullish" | "bearish" | "tangled";
  ema_squeeze_pct: number | null;
  bb_width: number | null;
  atr_pct: number | null;
  risk_flag: string | null;
  notes: Record<string, unknown>;
  source?: string;
}

const REGIME_META: Record<
  RegimeData["regime"],
  { zh: string; en: string; icon: React.ElementType; tone: string }
> = {
  strong_uptrend: {
    zh: "强趋势上涨",
    en: "Strong Uptrend",
    icon: TrendingUp,
    tone: "emerald",
  },
  strong_downtrend: {
    zh: "强趋势下跌",
    en: "Strong Downtrend",
    icon: TrendingDown,
    tone: "red",
  },
  squeeze_breakout_setup: {
    zh: "蓄势突破",
    en: "Squeeze Breakout Setup",
    icon: Zap,
    tone: "amber",
  },
  ranging: { zh: "区间震荡", en: "Ranging", icon: Minus, tone: "slate" },
  exhaustion_reversal: {
    zh: "趋势衰竭",
    en: "Exhaustion / Reversal",
    icon: AlertTriangle,
    tone: "purple",
  },
  elevated_event_risk: {
    zh: "事件风险期",
    en: "Elevated Event Risk",
    icon: AlertTriangle,
    tone: "orange",
  },
};

const TONE_CLS: Record<string, { card: string; text: string; bar: string }> = {
  emerald: {
    card: "border-emerald-500/30 bg-emerald-500/5",
    text: "text-emerald-400",
    bar: "bg-emerald-500",
  },
  red: {
    card: "border-red-500/30 bg-red-500/5",
    text: "text-red-400",
    bar: "bg-red-500",
  },
  amber: {
    card: "border-amber-500/30 bg-amber-500/5",
    text: "text-amber-400",
    bar: "bg-amber-500",
  },
  slate: {
    card: "border-white/10 bg-white/5",
    text: "text-slate-400",
    bar: "bg-slate-500",
  },
  purple: {
    card: "border-purple-500/30 bg-purple-500/5",
    text: "text-purple-400",
    bar: "bg-purple-500",
  },
  orange: {
    card: "border-orange-500/30 bg-orange-500/5",
    text: "text-orange-400",
    bar: "bg-orange-500",
  },
};

function MetricRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="whitespace-nowrap text-gray-500">{label}</span>
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="font-mono font-semibold whitespace-nowrap text-white tabular-nums">
          {value}
        </span>
        {hint && (
          <span className="text-[10px] whitespace-nowrap text-gray-600">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

export function SymbolRegimeCard({ symbol }: { symbol: string }) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const [data, setData] = useState<RegimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/v1/regime/symbol/${symbol}?fresh=true`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<RegimeData>;
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 py-10">
        <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
        <span className="ml-2 text-xs text-gray-500">
          {isZh ? "分析市场状态中…" : "Classifying regime…"}
        </span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="text-sm text-gray-600">
          {isZh ? "暂无市场状态数据" : "No regime data"} {error && `(${error})`}
        </p>
      </div>
    );
  }

  const meta = REGIME_META[data.regime];
  const tone = TONE_CLS[meta.tone];
  const Icon = meta.icon;
  const score = data.regime_score;
  const scoreLabel =
    score >= 80
      ? isZh
        ? "高置信"
        : "High"
      : score >= 60
        ? isZh
          ? "中等"
          : "Medium"
        : isZh
          ? "低置信"
          : "Low";

  // Determine which "criterion" booleans fired from notes
  const criteria: { label: string; ok: boolean }[] = [
    {
      label: isZh ? "ADX > 25 (趋势强度)" : "ADX > 25 (trending)",
      ok: (data.adx ?? 0) > 25,
    },
    {
      label: isZh ? "EMA 多头排列" : "EMA bullish stacked",
      ok: data.ema_alignment === "bullish",
    },
    {
      label: isZh ? "MA50 > MA200" : "MA50 > MA200",
      ok: !!(data.notes as { ma50_above_ma200?: boolean })?.ma50_above_ma200,
    },
    {
      label: isZh ? "价格 > MA200" : "Price > MA200",
      ok: !!(data.notes as { above_ma200?: boolean })?.above_ma200,
    },
    {
      label: isZh ? "高点抬高+低点抬高" : "Higher highs & lows",
      ok: !!(data.notes as { has_higher_highs_lows?: boolean })
        ?.has_higher_highs_lows,
    },
  ];

  return (
    <div className={`rounded-2xl border p-5 ${tone.card}`}>
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">
            {isZh ? "市场状态引擎" : "Market Regime"}
          </h3>
          <span className="text-xs text-gray-500">· ${data.symbol}</span>
        </div>
        <span className={`text-xs font-bold whitespace-nowrap ${tone.text}`}>
          {scoreLabel}
        </span>
      </div>

      {/* Big regime label + score */}
      <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Icon className={`h-6 w-6 ${tone.text}`} />
            <div>
              <p className="text-xs whitespace-nowrap text-gray-500">
                {isZh ? "当前状态" : "Current State"}
              </p>
              <p
                className={`text-base font-bold whitespace-nowrap ${tone.text}`}
              >
                {isZh ? meta.zh : meta.en}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-2xl font-bold tabular-nums ${tone.text}`}>
              {score.toFixed(0)}
            </p>
            <p className="text-[10px] text-gray-500">
              {isZh ? "置信分" : "score"} /100
            </p>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full transition-all duration-700 ${tone.bar}`}
            style={{ width: `${Math.min(score, 100)}%` }}
          />
        </div>
      </div>

      {/* Indicator metrics */}
      <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="space-y-1.5">
          <MetricRow
            label="ADX(14)"
            value={data.adx?.toFixed(1) ?? "—"}
            hint={
              data.adx
                ? data.adx > 25
                  ? isZh
                    ? "趋势"
                    : "trending"
                  : data.adx < 20
                    ? isZh
                      ? "震荡"
                      : "ranging"
                    : isZh
                      ? "过渡"
                      : "neutral"
                : ""
            }
          />
          <MetricRow
            label={isZh ? "EMA 排列" : "EMA Stack"}
            value={
              data.ema_alignment === "bullish"
                ? isZh
                  ? "多头 ↑"
                  : "Bullish"
                : data.ema_alignment === "bearish"
                  ? isZh
                    ? "空头 ↓"
                    : "Bearish"
                  : isZh
                    ? "缠绕"
                    : "Tangled"
            }
          />
          <MetricRow
            label={isZh ? "EMA 缠绕度" : "Squeeze %"}
            value={
              data.ema_squeeze_pct != null
                ? `${data.ema_squeeze_pct.toFixed(2)}%`
                : "—"
            }
            hint={
              data.ema_squeeze_pct != null && data.ema_squeeze_pct < 4
                ? isZh
                  ? "紧"
                  : "tight"
                : ""
            }
          />
        </div>
        <div className="space-y-1.5">
          <MetricRow
            label={isZh ? "布林带宽" : "BB Width"}
            value={data.bb_width != null ? `${data.bb_width.toFixed(2)}%` : "—"}
          />
          <MetricRow
            label={isZh ? "ATR%" : "ATR%"}
            value={data.atr_pct != null ? `${data.atr_pct.toFixed(2)}%` : "—"}
          />
          <MetricRow
            label={isZh ? "数据源" : "Source"}
            value={
              data.source === "db_cache"
                ? isZh
                  ? "缓存"
                  : "cached"
                : isZh
                  ? "实时"
                  : "live"
            }
          />
        </div>
      </div>

      {/* Criteria checklist */}
      <div>
        <p className="mb-2 text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
          {isZh ? "判定条件" : "Criteria"}
        </p>
        <div className="space-y-1">
          {criteria.map((c) => (
            <div key={c.label} className="flex items-center gap-2 text-[11px]">
              <span
                className={`flex h-3 w-3 items-center justify-center rounded-full ${
                  c.ok ? "bg-emerald-500/30" : "bg-red-500/20"
                }`}
              >
                <Target
                  className={`h-2 w-2 ${
                    c.ok ? "text-emerald-300" : "text-red-300"
                  }`}
                />
              </span>
              <span className={c.ok ? "text-emerald-300" : "text-gray-500"}>
                {c.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Risk flag */}
      {data.risk_flag && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 p-2">
          <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
          <span className="text-[11px] text-orange-300">
            {isZh
              ? `事件风险：${data.risk_flag}`
              : `Risk Flag: ${data.risk_flag}`}
          </span>
        </div>
      )}

      {/* Footer disclaimer */}
      <p className="mt-3 text-[9px] text-gray-700">
        {isZh
          ? "* 6 态分类基于 ADX / EMA / 布林带 / 趋势结构。规则化引擎，不构成投资建议。"
          : "* 6-state classification based on ADX/EMA/BB/structure. Rule-based, not investment advice."}
      </p>
    </div>
  );
}
