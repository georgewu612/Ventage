"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Target, TrendingUp, Loader2 } from "lucide-react";
import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";

interface VMData {
  symbol: string;
  regime: string;
  // Value layer
  value_score: number;
  value_tier: string;
  value_tier_zh: string;
  value_tier_en: string;
  pe_ratio: number | null;
  pb_ratio: number | null;
  ps_ratio: number | null;
  free_cashflow: number | null;
  debt_to_equity: number | null;
  roe: number | null;
  dividend_yield: number | null;
  revenue_growth: number | null;
  // Momentum layer
  momentum_score: number;
  momentum_direction: string | null;
  momentum_source: "db_signal" | "live_price";
  // Live price momentum detail (when source = live_price)
  rsi: number | null;
  above_200ma: boolean | null;
  return_6m_pct: number | null;
  // Composite
  vm_score: number;
  value_weight: number;
  momentum_weight: number;
  is_sweet_spot: boolean;
  sweet_spot_label_zh: string;
  sweet_spot_label_en: string;
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={`h-full rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${Math.min(score, 100)}%` }}
      />
    </div>
  );
}

function formatFCF(val: number | null): string {
  if (val === null || val === undefined) return "—";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "+";
  if (abs >= 1_000_000_000)
    return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(0)}M`;
  return `${sign}$${abs.toLocaleString()}`;
}

function fmt(val: number | null, decimals = 1, suffix = ""): string {
  if (val === null || val === undefined) return "—";
  return `${val.toFixed(decimals)}${suffix}`;
}

export function VMScoreCard({ symbol }: { symbol: string }) {
  const { t, locale } = useI18n();
  const isZh = locale === "zh";

  const [data, setData] = useState<VMData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/v1/technical/${symbol}/value`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 py-10">
        <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="text-sm text-gray-600">
          {isZh ? "暂无价值评分数据" : "No value score data available"}
        </p>
      </div>
    );
  }

  const vmColor =
    data.vm_score >= 70
      ? "bg-emerald-500"
      : data.vm_score >= 50
        ? "bg-amber-500"
        : "bg-red-500";

  const valueColor =
    data.value_score >= 70
      ? "bg-emerald-500"
      : data.value_score >= 50
        ? "bg-amber-500"
        : "bg-red-400";

  const momentumColor =
    data.momentum_score >= 70
      ? "bg-cyan-500"
      : data.momentum_score >= 50
        ? "bg-amber-500"
        : "bg-red-400";

  const tierLabel = isZh ? data.value_tier_zh : data.value_tier_en;
  const sweetLabel = isZh ? data.sweet_spot_label_zh : data.sweet_spot_label_en;

  const vWeight = Math.round(data.value_weight * 100);
  const mWeight = Math.round(data.momentum_weight * 100);

  return (
    <div
      className={`rounded-2xl border p-5 ${
        data.is_sweet_spot
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-white/10 bg-white/5"
      }`}
    >
      {/* ── Header ── */}
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">{t("vm.title")}</h3>
          {data.is_sweet_spot && sweetLabel && (
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
              {sweetLabel}
            </span>
          )}
        </div>
        {/* Big composite score */}
        <div className="text-right">
          <div
            className={`text-3xl font-bold tabular-nums ${
              data.vm_score >= 70
                ? "text-emerald-400"
                : data.vm_score >= 50
                  ? "text-amber-400"
                  : "text-red-400"
            }`}
          >
            {data.vm_score.toFixed(0)}
          </div>
          <div className="text-[10px] text-gray-500">V&M Score</div>
        </div>
      </div>

      {/* ── Regime weighting note ── */}
      <div className="mb-4 flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5">
        <span className="text-[10px] text-gray-500">
          {isZh ? "当前体制加权" : "Regime weighting"}:
        </span>
        <span className="text-[10px] font-semibold text-amber-300">
          {isZh ? "价值" : "Value"} {vWeight}%
        </span>
        <span className="text-[10px] text-gray-600">+</span>
        <span className="text-[10px] font-semibold text-cyan-300">
          {isZh ? "动能" : "Momentum"} {mWeight}%
        </span>
        <span className="ml-1 text-[10px] text-gray-600">({data.regime})</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* ── Value layer ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-400">
              {t("vm.valueLayer")}
            </span>
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
              {tierLabel}
            </span>
          </div>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-bold text-white">
              {data.value_score.toFixed(0)}
            </span>
            <span className="text-[10px] text-gray-500">/100</span>
          </div>
          <ScoreBar score={data.value_score} color={valueColor} />

          {/* Metrics grid */}
          <div className="mt-3 space-y-1.5 text-[11px]">
            {[
              {
                label: isZh ? "市盈率 P/E" : "P/E Ratio",
                value: fmt(data.pe_ratio, 1, "x"),
                good:
                  data.pe_ratio !== null &&
                  data.pe_ratio > 0 &&
                  data.pe_ratio < 20,
              },
              {
                label: isZh ? "市净率 P/B" : "P/B Ratio",
                value: fmt(data.pb_ratio, 2, "x"),
                good: data.pb_ratio !== null && data.pb_ratio < 2,
              },
              {
                label: isZh ? "自由现金流" : "Free Cash Flow",
                value: formatFCF(data.free_cashflow),
                good: data.free_cashflow !== null && data.free_cashflow > 0,
              },
              {
                label: isZh ? "负债/净资产" : "Debt/Equity",
                value: fmt(data.debt_to_equity, 2, "x"),
                good: data.debt_to_equity !== null && data.debt_to_equity < 1,
              },
              {
                label: "ROE",
                value: fmt(data.roe !== null ? data.roe * 100 : null, 1, "%"),
                good: data.roe !== null && data.roe > 0.12,
              },
              {
                label: isZh ? "股息率" : "Dividend Yield",
                value: fmt(
                  data.dividend_yield !== null
                    ? data.dividend_yield * 100
                    : null,
                  2,
                  "%",
                ),
                good:
                  data.dividend_yield !== null && data.dividend_yield > 0.02,
              },
            ].map(({ label, value, good }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-gray-500">{label}</span>
                <span
                  className={
                    good ? "font-semibold text-emerald-400" : "text-gray-300"
                  }
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Momentum layer ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-cyan-400">
              {t("vm.momentumLayer")}
            </span>
            {data.momentum_direction && (
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  data.momentum_direction === "bullish"
                    ? "bg-emerald-500/10 text-emerald-400"
                    : data.momentum_direction === "bearish"
                      ? "bg-red-500/10 text-red-400"
                      : "bg-gray-500/10 text-gray-400"
                }`}
              >
                {isZh
                  ? data.momentum_direction === "bullish"
                    ? "看涨"
                    : data.momentum_direction === "bearish"
                      ? "看跌"
                      : "中性"
                  : data.momentum_direction}
              </span>
            )}
          </div>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-bold text-white">
              {data.momentum_score.toFixed(0)}
            </span>
            <span className="text-[10px] text-gray-500">/100</span>
          </div>
          <ScoreBar score={data.momentum_score} color={momentumColor} />

          {/* Momentum explanation */}
          <div className="mt-3 space-y-2">
            {/* Live price indicators (when no DB signal) */}
            {data.momentum_source === "live_price" && (
              <div className="space-y-1.5 text-[11px]">
                {[
                  {
                    label: "RSI (14)",
                    value: data.rsi !== null ? `${data.rsi.toFixed(1)}` : "—",
                    good: data.rsi !== null && data.rsi > 50 && data.rsi < 70,
                  },
                  {
                    label: isZh ? "站上200日均线" : "Above 200-day MA",
                    value:
                      data.above_200ma === null
                        ? "—"
                        : data.above_200ma
                          ? isZh
                            ? "是 ✓"
                            : "Yes ✓"
                          : isZh
                            ? "否 ✗"
                            : "No ✗",
                    good: data.above_200ma === true,
                  },
                  {
                    label: isZh ? "6个月收益" : "6M Return",
                    value:
                      data.return_6m_pct !== null
                        ? `${data.return_6m_pct > 0 ? "+" : ""}${data.return_6m_pct.toFixed(1)}%`
                        : "—",
                    good: data.return_6m_pct !== null && data.return_6m_pct > 5,
                  },
                ].map(({ label, value, good }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between"
                  >
                    <span className="text-gray-500">{label}</span>
                    <span
                      className={
                        good ? "font-semibold text-cyan-400" : "text-gray-300"
                      }
                    >
                      {value}
                    </span>
                  </div>
                ))}
                <p className="text-[9px] text-gray-600">
                  {isZh
                    ? "* 实时价格计算（无信号记录）"
                    : "* Computed from live price (no signal record)"}
                </p>
              </div>
            )}
            {data.momentum_source === "db_signal" && (
              <p className="text-[10px] leading-relaxed text-gray-500">
                {isZh
                  ? `动能分基于最新市场信号综合评分。当前体制 "${data.regime}" 下，动能因子权重为 ${mWeight}%。`
                  : `Momentum score from latest signal analysis. Under "${data.regime}" regime, momentum weight is ${mWeight}%.`}
              </p>
            )}

            {data.is_sweet_spot ? (
              <div className="flex items-start gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2">
                <TrendingUp className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                <p className="text-[10px] leading-relaxed text-emerald-300">
                  {isZh
                    ? "价值与动能双重确认，可能处于均值回归起点。"
                    : "Both value and momentum confirmed — possible mean reversion entry point."}
                </p>
              </div>
            ) : data.value_score >= 60 && data.momentum_score < 50 ? (
              <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                <p className="text-[10px] leading-relaxed text-amber-300">
                  {isZh
                    ? "价值低估但动能尚未启动，可能是价值陷阱，等待动能确认。"
                    : "Undervalued but momentum not confirmed — potential value trap, wait for momentum."}
                </p>
              </div>
            ) : data.momentum_score >= 60 && data.value_score < 40 ? (
              <div className="flex items-start gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 p-2">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red-400" />
                <p className="text-[10px] leading-relaxed text-red-300">
                  {isZh
                    ? "动能强但估值偏高，追高风险较大，注意安全边际。"
                    : "Strong momentum but expensive valuation — chasing risk, watch safety margin."}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Composite bar ── */}
      <div className="mt-4 border-t border-white/5 pt-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] text-gray-500">
            {t("vm.compositeScore")}
          </span>
          <span
            className={`text-xs font-bold ${
              data.vm_score >= 70
                ? "text-emerald-400"
                : data.vm_score >= 50
                  ? "text-amber-400"
                  : "text-red-400"
            }`}
          >
            {data.vm_score.toFixed(1)} / 100
          </span>
        </div>
        <ScoreBar score={data.vm_score} color={vmColor} />
        <p className="mt-1.5 text-[9px] text-gray-700">
          {isZh
            ? "* 本评分仅供参考，不构成投资建议。学术研究（Fama-French）表明价值与动能因子长期负相关。"
            : "* For reference only. Academic research (Fama-French) shows value & momentum are negatively correlated over cycles."}
        </p>
      </div>
    </div>
  );
}
