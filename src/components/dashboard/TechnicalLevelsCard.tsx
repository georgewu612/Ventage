"use client";

import { useEffect, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  BarChart2,
} from "lucide-react";
import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SRLevel {
  price: number;
  touch_count: number;
  strength: "weak" | "medium" | "strong" | "key";
}

interface Pattern {
  name_zh: string;
  name_en: string;
  desc_zh: string;
  desc_en: string;
  severity: "bullish" | "bearish" | "neutral";
}

export interface TechnicalLevelsData {
  symbol: string;
  current_price: number;
  rsi: number;
  bias: "bullish" | "bearish" | "neutral";
  summary_zh: string;
  summary_en: string;
  support_levels: SRLevel[];
  resist_levels: SRLevel[];
  fibonacci: Record<string, number>;
  price_targets: { bull: number; base: number; bear: number };
  patterns: Pattern[];
  week52_high: number;
  week52_low: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STRENGTH_LABEL: Record<string, { zh: string; en: string }> = {
  key: { zh: "关键", en: "Key" },
  strong: { zh: "强", en: "Strong" },
  medium: { zh: "中", en: "Medium" },
  weak: { zh: "弱", en: "Weak" },
};

const STRENGTH_DOT: Record<string, string> = {
  key: "bg-white ring-2 ring-offset-1 ring-offset-slate-900",
  strong: "bg-white/80",
  medium: "bg-white/50",
  weak: "bg-white/30",
};

function BiasIcon({ bias }: { bias: string }) {
  if (bias === "bullish")
    return <TrendingUp className="h-4 w-4 text-emerald-400" />;
  if (bias === "bearish")
    return <TrendingDown className="h-4 w-4 text-red-400" />;
  return <Minus className="h-4 w-4 text-gray-400" />;
}

function SeverityBadge({
  severity,
  label,
}: {
  severity: string;
  label: string;
}) {
  const cls =
    severity === "bullish"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
      : severity === "bearish"
        ? "bg-red-500/15 text-red-400 border-red-500/20"
        : "bg-gray-500/15 text-gray-400 border-gray-500/20";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${cls}`}
    >
      {label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  symbol: string;
  onDataLoaded?: (data: TechnicalLevelsData) => void;
}

export function TechnicalLevelsCard({ symbol, onDataLoaded }: Props) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const [data, setData] = useState<TechnicalLevelsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/v1/technical/${symbol}/levels`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<TechnicalLevelsData>;
      })
      .then((d) => {
        setData(d);
        onDataLoaded?.(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [symbol, onDataLoaded]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 py-10">
        <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
        <span className="ml-2 text-xs text-gray-500">
          {isZh ? "识别技术形态中…" : "Detecting patterns…"}
        </span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="text-sm text-gray-600">
          {isZh ? "暂无技术分析数据" : "No technical analysis data"}
        </p>
      </div>
    );
  }

  const biasColor =
    data.bias === "bullish"
      ? "text-emerald-400"
      : data.bias === "bearish"
        ? "text-red-400"
        : "text-gray-400";

  const biasBorder =
    data.bias === "bullish"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : data.bias === "bearish"
        ? "border-red-500/30 bg-red-500/5"
        : "border-white/10 bg-white/5";

  const biasLabel =
    data.bias === "bullish"
      ? isZh
        ? "偏多"
        : "Bullish"
      : data.bias === "bearish"
        ? isZh
          ? "偏空"
          : "Bearish"
        : isZh
          ? "中性"
          : "Neutral";

  return (
    <div className={`rounded-2xl border p-5 ${biasBorder}`}>
      {/* ── Header ── */}
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">
            {isZh ? "技术判断" : "Technical Analysis"}
          </h3>
          <span className="text-xs text-gray-500">· ${symbol}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <BiasIcon bias={data.bias} />
          <span className={`text-xs font-bold ${biasColor}`}>{biasLabel}</span>
        </div>
      </div>

      {/* ── AI Summary ── */}
      <div className="mb-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
        <p className="text-sm leading-relaxed text-gray-200">
          {isZh ? data.summary_zh : data.summary_en}
        </p>
        <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500">
          <span>RSI {data.rsi}</span>
          <span>·</span>
          <span>
            {isZh ? "52周高" : "52W H"} ${data.week52_high}
          </span>
          <span>·</span>
          <span>
            {isZh ? "52周低" : "52W L"} ${data.week52_low}
          </span>
        </div>
      </div>

      {/* ── Price Targets ── */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        {[
          {
            label: isZh ? "多头目标" : "Bull Target",
            price: data.price_targets.bull,
            color: "text-emerald-400",
            bg: "bg-emerald-500/10 border-emerald-500/20",
          },
          {
            label: isZh ? "基准价位" : "Base",
            price: data.price_targets.base,
            color: "text-gray-300",
            bg: "bg-white/5 border-white/10",
          },
          {
            label: isZh ? "空头目标" : "Bear Target",
            price: data.price_targets.bear,
            color: "text-red-400",
            bg: "bg-red-500/10 border-red-500/20",
          },
        ].map(({ label, price, color, bg }) => (
          <div
            key={label}
            className={`rounded-xl border p-2.5 text-center ${bg}`}
          >
            <p className="mb-0.5 text-[9px] text-gray-500">{label}</p>
            <p className={`text-sm font-bold tabular-nums ${color}`}>
              ${price}
            </p>
          </div>
        ))}
      </div>

      {/* ── S/R Levels ── */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        {/* Resistance */}
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-wider text-red-400 uppercase">
            {isZh ? "🔴 压力位" : "🔴 Resistance"}
          </p>
          <div className="space-y-1.5">
            {data.resist_levels.slice(0, 4).map((lv) => {
              const sl = STRENGTH_LABEL[lv.strength];
              return (
                <div
                  key={lv.price}
                  className="flex items-center justify-between rounded-lg bg-red-500/5 px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${STRENGTH_DOT[lv.strength]}`}
                      style={{ background: "rgba(239,68,68,0.8)" }}
                    />
                    <span className="text-xs font-semibold text-red-300 tabular-nums">
                      ${lv.price}
                    </span>
                  </div>
                  <span className="text-[9px] text-gray-600">
                    {isZh ? sl.zh : sl.en} · {lv.touch_count}
                    {isZh ? "次" : "x"}
                  </span>
                </div>
              );
            })}
            {data.resist_levels.length === 0 && (
              <p className="text-[10px] text-gray-600">
                {isZh ? "无明显压力位" : "No clear resistance"}
              </p>
            )}
          </div>
        </div>

        {/* Support */}
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-wider text-emerald-400 uppercase">
            {isZh ? "🟢 支撑位" : "🟢 Support"}
          </p>
          <div className="space-y-1.5">
            {data.support_levels.slice(0, 4).map((lv) => {
              const sl = STRENGTH_LABEL[lv.strength];
              return (
                <div
                  key={lv.price}
                  className="flex items-center justify-between rounded-lg bg-emerald-500/5 px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: "rgba(16,185,129,0.8)" }}
                    />
                    <span className="text-xs font-semibold text-emerald-300 tabular-nums">
                      ${lv.price}
                    </span>
                  </div>
                  <span className="text-[9px] text-gray-600">
                    {isZh ? sl.zh : sl.en} · {lv.touch_count}
                    {isZh ? "次" : "x"}
                  </span>
                </div>
              );
            })}
            {data.support_levels.length === 0 && (
              <p className="text-[10px] text-gray-600">
                {isZh ? "无明显支撑位" : "No clear support"}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Detected Patterns ── */}
      {data.patterns.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
            {isZh ? "📊 识别形态" : "📊 Detected Patterns"}
          </p>
          <div className="space-y-2">
            {data.patterns.map((p, i) => (
              <div
                key={i}
                className="rounded-xl border border-white/5 bg-white/5 px-3 py-2.5"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-semibold text-white">
                    {isZh ? p.name_zh : p.name_en}
                  </span>
                  <SeverityBadge
                    severity={p.severity}
                    label={
                      p.severity === "bullish"
                        ? isZh
                          ? "多"
                          : "Bull"
                        : p.severity === "bearish"
                          ? isZh
                            ? "空"
                            : "Bear"
                          : isZh
                            ? "中性"
                            : "Neutral"
                    }
                  />
                </div>
                <p className="text-[10px] leading-relaxed text-gray-400">
                  {isZh ? p.desc_zh : p.desc_en}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Fibonacci Levels ── */}
      <details className="group">
        <summary className="cursor-pointer text-[10px] text-gray-500 hover:text-gray-300">
          {isZh
            ? "Fibonacci 回撤位（点击展开）"
            : "Fibonacci Retracements (click to expand)"}
        </summary>
        <div className="mt-2 space-y-1">
          {Object.entries(data.fibonacci).map(([pct, price]) => (
            <div
              key={pct}
              className="flex items-center justify-between rounded px-2 py-1 text-[11px]"
            >
              <span className="text-gray-600">{pct}%</span>
              <span className="text-gray-400 tabular-nums">${price}</span>
            </div>
          ))}
        </div>
      </details>

      {/* Footer */}
      <p className="mt-3 text-[9px] text-gray-700">
        {isZh
          ? "* 技术分析仅供参考，不构成投资建议。历史形态不代表未来表现。"
          : "* For reference only. Past patterns do not guarantee future results."}
      </p>
    </div>
  );
}
