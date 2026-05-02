"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Calculator,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProjectedFCF {
  year: number;
  fcf: number;
  pv: number;
}

interface SensitivityCell {
  wacc: number;
  growth: number;
  fair_value: number;
}

interface DCFResult {
  symbol: string;
  sector: string | null;
  current_price: number;
  market_cap: number | null;
  fcf_history: number[];
  fcf_growth_used: number;
  wacc_used: number;
  terminal_growth: number;
  net_debt: number;
  shares_outstanding: number;
  projected_fcfs: ProjectedFCF[];
  terminal_value: number;
  terminal_value_pv: number;
  enterprise_value: number;
  fair_value_per_share: number;
  upside_pct: number;
  rating: "undervalued" | "fairly_valued" | "overvalued";
  sensitivity: SensitivityCell[][];
  validation_passes: boolean;
  validation_notes: string[];
  warnings: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLargeNumber(n: number): string {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DCFCard({ symbol }: { symbol: string }) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const [data, setData] = useState<DCFResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/valuation/dcf/${symbol}`);
      if (!res.ok) {
        // Extract human-readable message from FastAPI's {detail: "..."} envelope
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          msg = typeof body?.detail === "string" ? body.detail : JSON.stringify(body);
        } catch {
          msg = await res.text();
        }
        throw new Error(msg);
      }
      setData(await res.json());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
        <div className="mb-3 flex items-center gap-2">
          <Calculator className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-semibold text-white">
            {isZh ? "DCF 估值" : "DCF Valuation"}
          </span>
        </div>
        <div className="h-32 animate-pulse rounded bg-white/5" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
        <div className="mb-2 flex items-center gap-2">
          <Calculator className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-semibold text-white">
            {isZh ? "DCF 估值" : "DCF Valuation"}
          </span>
        </div>
        <p className="text-xs text-gray-500">
          {error
            ? isZh
              ? `数据不足：${error.slice(0, 150)}`
              : `Insufficient data: ${error.slice(0, 150)}`
            : isZh
              ? "暂无数据"
              : "No data"}
        </p>
        {error && (
          <button
            onClick={load}
            className="mt-2 text-[11px] text-cyan-300 hover:underline"
          >
            {isZh ? "重试" : "Retry"}
          </button>
        )}
      </div>
    );
  }

  // Rating colors
  const ratingConfig = {
    undervalued: {
      icon: TrendingUp,
      color: "text-emerald-300",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/30",
      label: isZh ? "低估" : "Undervalued",
    },
    fairly_valued: {
      icon: Minus,
      color: "text-amber-300",
      bg: "bg-amber-500/10",
      border: "border-amber-500/30",
      label: isZh ? "合理估值" : "Fairly Valued",
    },
    overvalued: {
      icon: TrendingDown,
      color: "text-red-300",
      bg: "bg-red-500/10",
      border: "border-red-500/30",
      label: isZh ? "高估" : "Overvalued",
    },
  } as const;

  const cfg = ratingConfig[data.rating];
  const RatingIcon = cfg.icon;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-semibold text-white">
            {isZh ? "DCF 估值" : "DCF Valuation"}
          </span>
        </div>
        <span className="text-[10px] text-gray-500">
          {data.sector ?? (isZh ? "未知行业" : "Unknown")}
        </span>
      </div>

      {/* Main result */}
      <div
        className={`mb-3 rounded-xl border-2 p-4 ${cfg.border} ${cfg.bg}`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className={`mb-0.5 text-xs font-medium ${cfg.color}`}>
              <RatingIcon className="mr-1 inline h-3 w-3" />
              {cfg.label}
            </p>
            <p className="font-mono text-3xl font-bold text-white">
              ${data.fair_value_per_share.toFixed(2)}
            </p>
            <p className="mt-0.5 text-[10px] text-gray-400">
              {isZh ? "公允价值/股" : "Fair Value / Share"}
            </p>
          </div>
          <div className="text-right">
            <p className={`font-mono text-xl font-bold ${cfg.color}`}>
              {data.upside_pct > 0 ? "+" : ""}
              {data.upside_pct.toFixed(1)}%
            </p>
            <p className="mt-0.5 text-[10px] text-gray-400">
              {isZh ? "vs 当前价" : "vs Current"}
            </p>
            <p className="mt-1 font-mono text-xs text-gray-300">
              ${data.current_price.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* Key inputs */}
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-white/5 px-2 py-2">
          <p className="text-[9px] text-gray-500">
            {isZh ? "FCF 增长" : "FCF Growth"}
          </p>
          <p className="font-mono text-sm font-semibold text-cyan-300">
            {data.fcf_growth_used > 0 ? "+" : ""}
            {data.fcf_growth_used.toFixed(1)}%
          </p>
        </div>
        <div className="rounded-lg bg-white/5 px-2 py-2">
          <p className="text-[9px] text-gray-500">WACC</p>
          <p className="font-mono text-sm font-semibold text-amber-300">
            {data.wacc_used.toFixed(1)}%
          </p>
        </div>
        <div className="rounded-lg bg-white/5 px-2 py-2">
          <p className="text-[9px] text-gray-500">
            {isZh ? "终值增长" : "Terminal G"}
          </p>
          <p className="font-mono text-sm font-semibold text-violet-300">
            {data.terminal_growth.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <div className="mb-3 space-y-1">
          {data.warnings.map((w, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
              <p className="text-[10px] text-amber-300">{w}</p>
            </div>
          ))}
        </div>
      )}

      {/* Show / hide details */}
      <button
        onClick={() => setShowDetails((s) => !s)}
        className="flex w-full items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] font-medium text-cyan-300 transition-colors hover:bg-white/10"
      >
        {showDetails ? (
          <>
            <ChevronUp className="h-3 w-3" />
            {isZh ? "收起详情" : "Hide Details"}
          </>
        ) : (
          <>
            <ChevronDown className="h-3 w-3" />
            {isZh ? "展开详情（投影 + 敏感性）" : "Show Details"}
          </>
        )}
      </button>

      {showDetails && (
        <div className="mt-3 space-y-3">
          {/* Projection table */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold text-gray-400">
              {isZh ? "5 年 FCF 投影" : "5-Year FCF Projection"}
            </p>
            <div className="overflow-hidden rounded-lg border border-white/10">
              <table className="w-full text-[10px]">
                <thead className="bg-white/5">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-gray-500">
                      {isZh ? "年" : "Year"}
                    </th>
                    <th className="px-2 py-1.5 text-right text-gray-500">
                      {isZh ? "预期 FCF" : "Projected FCF"}
                    </th>
                    <th className="px-2 py-1.5 text-right text-gray-500">
                      {isZh ? "现值" : "PV"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.projected_fcfs.map((p) => (
                    <tr
                      key={p.year}
                      className="border-t border-white/5 font-mono"
                    >
                      <td className="px-2 py-1 text-gray-400">Y{p.year}</td>
                      <td className="px-2 py-1 text-right text-white">
                        {formatLargeNumber(p.fcf)}
                      </td>
                      <td className="px-2 py-1 text-right text-cyan-300">
                        {formatLargeNumber(p.pv)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-white/10 bg-white/5 font-mono">
                    <td className="px-2 py-1 text-violet-300">
                      {isZh ? "终值" : "Terminal"}
                    </td>
                    <td className="px-2 py-1 text-right text-white">
                      {formatLargeNumber(data.terminal_value)}
                    </td>
                    <td className="px-2 py-1 text-right text-violet-300">
                      {formatLargeNumber(data.terminal_value_pv)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Sensitivity matrix */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold text-gray-400">
              {isZh
                ? "敏感性分析（公允价值 / 股）"
                : "Sensitivity (Fair Value / Share)"}
            </p>
            <div className="overflow-hidden rounded-lg border border-white/10">
              <table className="w-full text-[10px]">
                <thead className="bg-white/5">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-gray-500">
                      WACC ↓ / G →
                    </th>
                    {data.sensitivity[0].map((c) => (
                      <th
                        key={c.growth}
                        className="px-2 py-1.5 text-right text-gray-500"
                      >
                        {c.growth.toFixed(1)}%
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.sensitivity.map((row, i) => (
                    <tr key={i} className="border-t border-white/5 font-mono">
                      <td className="px-2 py-1 text-amber-300">
                        {row[0].wacc.toFixed(1)}%
                      </td>
                      {row.map((c, j) => {
                        const isCenter = i === 1 && j === 1;
                        return (
                          <td
                            key={j}
                            className={`px-2 py-1 text-right ${
                              isCenter
                                ? "bg-violet-500/20 font-bold text-white"
                                : "text-gray-300"
                            }`}
                          >
                            ${c.fair_value.toFixed(0)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[9px] text-gray-600">
              {isZh
                ? "中心格 = 当前估值 · 越绿越被低估"
                : "Center = base case · Greener = more upside"}
            </p>
          </div>

          {/* Methodology footnote */}
          <p className="text-[9px] text-gray-600">
            {isZh
              ? "* DCF 仅基于历史 FCF + 增长假设，不构成投资建议"
              : "* DCF based on historical FCF + growth assumptions; not investment advice"}
          </p>
        </div>
      )}
    </div>
  );
}
