"use client";

import { useEffect, useState } from "react";
import { Clock, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";

import { useI18n } from "@/lib/i18n/provider";

interface AnalogWindow {
  start: string;
  vix: number;
  return_5d: number | null;
  return_20d: number | null;
}

interface AnalogData {
  symbol: string;
  regime: string;
  current_vix: number | null;
  sample_count: number;
  avg_5d: number | null;
  avg_10d: number | null;
  avg_20d: number | null;
  win_rate_5d: number | null;
  win_rate_20d: number | null;
  max_drawdown_pct: number | null;
  windows: AnalogWindow[];
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://faithful-simplicity-production-3a01.up.railway.app";

function ReturnPill({ value, label }: { value: number | null; label: string }) {
  if (value === null) return null;
  const positive = value >= 0;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-xs text-gray-500">{label}</span>
      <span
        className={`text-sm font-semibold ${positive ? "text-emerald-400" : "text-red-400"}`}
      >
        {positive ? "+" : ""}
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

export function HistoricalAnalogCard({ symbol }: { symbol: string }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<AnalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/v1/technical/${symbol.toUpperCase()}/analog`)
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
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-semibold text-white">
            {locale === "zh" ? "历史类比分析" : "Historical Analog"}
          </span>
        </div>
        <div className="h-16 animate-pulse rounded-lg bg-white/5" />
      </div>
    );
  }

  if (error || !data || data.sample_count === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-semibold text-white">
            {locale === "zh" ? "历史类比分析" : "Historical Analog"}
          </span>
        </div>
        <p className="text-sm text-gray-500">
          {locale === "zh"
            ? "当前市场环境下历史类比样本不足"
            : "Insufficient historical analogs for current market environment"}
        </p>
      </div>
    );
  }

  // Sparkline: small bar chart from windows
  const maxAbs = Math.max(
    ...data.windows
      .map((w) => Math.abs(w.return_20d ?? 0))
      .filter((v) => v > 0),
    1,
  );

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-semibold text-white">
            {locale === "zh" ? "历史类比分析" : "Historical Analog"}
          </span>
        </div>
        <span className="rounded-full bg-purple-500/10 px-2 py-0.5 text-xs text-purple-300">
          {locale === "zh"
            ? `${data.sample_count} 个类似环境`
            : `${data.sample_count} analog periods`}
        </span>
      </div>

      {/* Stats row */}
      <div className="mb-4 grid grid-cols-4 gap-2 rounded-lg bg-white/5 p-3">
        <ReturnPill
          value={data.avg_5d}
          label={locale === "zh" ? "5日均收益" : "Avg 5d"}
        />
        <ReturnPill
          value={data.avg_20d}
          label={locale === "zh" ? "20日均收益" : "Avg 20d"}
        />
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-xs text-gray-500">
            {locale === "zh" ? "20日胜率" : "20d Win Rate"}
          </span>
          <span className="text-sm font-semibold text-cyan-400">
            {data.win_rate_20d !== null ? `${data.win_rate_20d}%` : "—"}
          </span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-xs text-gray-500">
            {locale === "zh" ? "最大回撤" : "Max Drawdown"}
          </span>
          <span className="text-sm font-semibold text-amber-400">
            {data.max_drawdown_pct !== null
              ? `${data.max_drawdown_pct.toFixed(1)}%`
              : "—"}
          </span>
        </div>
      </div>

      {/* Sparkline — 20-day forward returns as mini bars */}
      <div className="mb-3">
        <p className="mb-1.5 text-xs text-gray-500">
          {locale === "zh"
            ? "历史各类比窗口 20 日收益分布"
            : "20-day return distribution across analog periods"}
        </p>
        <div className="flex h-10 items-end gap-0.5">
          {data.windows.slice(-20).map((w, i) => {
            const ret = w.return_20d ?? 0;
            const height = Math.max(2, (Math.abs(ret) / maxAbs) * 36);
            return (
              <div
                key={i}
                title={`${w.start}: ${ret > 0 ? "+" : ""}${ret.toFixed(1)}%`}
                className={`flex-1 rounded-sm ${ret >= 0 ? "bg-emerald-500/60" : "bg-red-500/60"}`}
                style={{ height: `${height}px` }}
              />
            );
          })}
        </div>
      </div>

      {/* Disclaimer */}
      <p className="text-[10px] text-gray-600">
        {locale === "zh"
          ? "⚠️ 历史数据仅供参考，不代表未来表现，不构成投资建议"
          : "⚠️ Historical data for reference only. Past performance does not guarantee future results."}
      </p>
    </div>
  );
}
