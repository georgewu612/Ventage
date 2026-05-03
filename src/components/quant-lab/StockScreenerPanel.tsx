"use client";

/**
 * Stock Screener — filter SP500 by multi-factor conditions.
 *
 * Drives the POST /v1/factors/screener endpoint. Users can:
 *   - Pick from curated preset templates (based on actual IC findings)
 *   - Build custom conditions row-by-row
 *   - Filter by sector + min market cap
 *   - Sort + limit results
 *
 * Each result row links to /dashboard/stocks/{symbol}.
 */

import { useState, useCallback } from "react";
import {
  Filter,
  Plus,
  Trash2,
  Loader2,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";

// ── Factor labels (synced with Phase III FACTOR_LABELS) ─────────────────────

const FACTOR_LABELS: Record<string, { zh: string; en: string }> = {
  // Style
  value: { zh: "价值", en: "Value" },
  quality: { zh: "质量", en: "Quality" },
  momentum: { zh: "动量 12-1m", en: "Momentum 12-1m" },
  size: { zh: "小盘", en: "Size" },
  low_vol: { zh: "低波动", en: "Low Vol" },
  low_inv: { zh: "低投资", en: "Low Inv" },
  // Technical
  momentum_60d: { zh: "动量 60d", en: "Momentum 60d" },
  momentum_120d: { zh: "动量 120d", en: "Momentum 120d" },
  breakout_20d: { zh: "20 日突破", en: "Breakout 20d" },
  new_high_52w: { zh: "52 周新高", en: "52w High" },
  volume_spike_5d: { zh: "5 日量能脉冲", en: "Vol Spike 5d" },
  volume_trend_20d: { zh: "20 日量能趋势", en: "Vol Trend 20d" },
  rs_vs_spy: { zh: "相对 SPY 强度", en: "RS vs SPY" },
  sector_strength: { zh: "行业强度", en: "Sector Strength" },
  // Clusters
  momentum_cluster: { zh: "动量集群", en: "Momentum Cluster" },
  volume_cluster: { zh: "量能集群", en: "Volume Cluster" },
  structure_cluster: { zh: "市场结构集群", en: "Structure Cluster" },
  // Meta
  market_cap: { zh: "市值 (USD)", en: "Market Cap (USD)" },
};

const ALL_FACTOR_OPTIONS = Object.keys(FACTOR_LABELS);

const OPERATORS: Array<">=" | ">" | "<=" | "<" | "==" | "!="> = [
  ">=",
  ">",
  "<=",
  "<",
  "==",
  "!=",
];

interface Condition {
  factor: string;
  op: string;
  value: number;
}

interface ScreenerResult {
  matched: number;
  total_in_universe: number;
  applied_conditions: Array<{
    condition: Condition;
    before?: number;
    after?: number;
    filtered_out?: number;
    matched?: string;
  }>;
  results: Array<{
    symbol: string;
    sector: string | null;
    market_cap: number | null;
    factors: Record<string, number | null>;
  }>;
}

// ── Preset templates (based on Phase IV IC findings on SP500) ──────────────

interface Preset {
  key: string;
  zhName: string;
  enName: string;
  zhDesc: string;
  enDesc: string;
  conditions: Condition[];
  sortBy?: string;
}

const PRESETS: Preset[] = [
  {
    key: "triple_confirmation",
    zhName: "⭐ 三重确认（推荐）",
    enName: "⭐ Triple Confirmation (recommended)",
    zhDesc:
      "52 周新高 + 跑赢 SPY + 3 月强动量。基于 SP500 IC 分析最强 3 个因子的交集。",
    enDesc:
      "52w high + RS > SPY + 3-mo momentum. Top 3 IC factors intersected.",
    conditions: [
      { factor: "new_high_52w", op: ">=", value: 0.85 },
      { factor: "rs_vs_spy", op: ">=", value: 0.05 },
      { factor: "momentum_60d", op: ">=", value: 0.1 },
    ],
    sortBy: "momentum_12_1m",
  },
  {
    key: "momentum_pure",
    zhName: "🚀 纯动量",
    enName: "🚀 Pure Momentum",
    zhDesc: "动量 12-1m 高 + 接近 52 周高 + 大盘股。最直接的趋势跟随。",
    enDesc: "Strong 12-1m momentum + near 52w high + large cap.",
    conditions: [
      { factor: "momentum", op: ">=", value: 0.3 },
      { factor: "new_high_52w", op: ">=", value: 0.9 },
      { factor: "market_cap", op: ">=", value: 20_000_000_000 },
    ],
    sortBy: "momentum",
  },
  {
    key: "quality_trend",
    zhName: "🛡️ 质量+趋势",
    enName: "🛡️ Quality + Trend",
    zhDesc: "高质量股 + 趋势向上。降低集中度风险，长期持有友好。",
    enDesc: "High quality + uptrend. Lower-risk core holdings.",
    conditions: [
      { factor: "quality", op: ">=", value: 0.2 },
      { factor: "new_high_52w", op: ">=", value: 0.7 },
      { factor: "rs_vs_spy", op: ">=", value: 0 },
    ],
    sortBy: "quality",
  },
  {
    key: "avoid_top",
    zhName: "🎯 避免顶部",
    enName: "🎯 Avoid Tops",
    zhDesc:
      "强势股但近期没爆量（避免短期派发顶）。基于 FM 回归发现量能脉冲反向显著。",
    enDesc:
      "Strong + no recent volume spike (avoid short-term tops). Based on FM regression: vol_spike_5d t=-2.19.",
    conditions: [
      { factor: "new_high_52w", op: ">=", value: 0.85 },
      { factor: "rs_vs_spy", op: ">=", value: 0.03 },
      { factor: "volume_spike_5d", op: "<=", value: 1.3 },
    ],
    sortBy: "rs_vs_spy",
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMarketCap(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

function fmtFactor(v: number | null): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1000) return v.toExponential(2);
  if (Math.abs(v) >= 100) return v.toFixed(1);
  if (Math.abs(v) >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

// ── Main Component ────────────────────────────────────────────────────────

export function StockScreenerPanel() {
  const { locale } = useI18n();
  const zh = locale === "zh";

  const [conditions, setConditions] = useState<Condition[]>(
    PRESETS[0].conditions,
  );
  const [sortBy, setSortBy] = useState<string>("market_cap");
  const [sortDesc, setSortDesc] = useState(true);
  const [limit, setLimit] = useState(50);
  const [activePreset, setActivePreset] = useState<string | null>(
    PRESETS[0].key,
  );

  const [result, setResult] = useState<ScreenerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (preset: Preset) => {
    setConditions(preset.conditions);
    setActivePreset(preset.key);
    if (preset.sortBy) setSortBy(preset.sortBy);
  };

  const addCondition = () => {
    setConditions([
      ...conditions,
      { factor: "new_high_52w", op: ">=", value: 0.5 },
    ]);
    setActivePreset(null);
  };

  const updateCondition = (i: number, patch: Partial<Condition>) => {
    setConditions(
      conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    );
    setActivePreset(null);
  };

  const removeCondition = (i: number) => {
    setConditions(conditions.filter((_, idx) => idx !== i));
    setActivePreset(null);
  };

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE_URL}/v1/factors/screener`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conditions,
          sort_by: sortBy,
          sort_desc: sortDesc,
          limit,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${r.status}`);
      }
      setResult(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [conditions, sortBy, sortDesc, limit]);

  // Build display columns: meta + factors used in conditions + sortBy
  const displayFactors = Array.from(
    new Set([
      ...conditions.map((c) => c.factor).filter((f) => f !== "market_cap"),
      ...(sortBy && sortBy !== "market_cap" ? [sortBy] : []),
    ]),
  );

  return (
    <div className="space-y-4">
      {/* Preset templates */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-violet-300">
          <Sparkles className="h-3 w-3" />
          {zh ? "预设策略（基于 IC 分析）" : "Presets (based on IC findings)"}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PRESETS.map((p) => {
            const active = activePreset === p.key;
            return (
              <button
                key={p.key}
                onClick={() => applyPreset(p)}
                className={`rounded-lg border p-2.5 text-left transition-all ${
                  active
                    ? "border-violet-500/50 bg-violet-500/10 ring-1 ring-violet-500/30"
                    : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
                }`}
              >
                <p className="text-xs font-semibold text-white">
                  {zh ? p.zhName : p.enName}
                </p>
                <p className="mt-1 text-[10px] text-gray-400">
                  {zh ? p.zhDesc : p.enDesc}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Conditions builder */}
      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-300">
            <Filter className="h-3 w-3" />
            {zh ? "筛选条件" : "Filter Conditions"}
          </p>
          <button
            onClick={addCondition}
            className="flex items-center gap-1 rounded bg-cyan-500/20 px-2 py-1 text-[10px] text-cyan-300 hover:bg-cyan-500/30"
          >
            <Plus className="h-3 w-3" />
            {zh ? "添加" : "Add"}
          </button>
        </div>

        <div className="space-y-1.5">
          {conditions.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <select
                value={c.factor}
                onChange={(e) => updateCondition(i, { factor: e.target.value })}
                className="flex-1 rounded-md border border-white/10 bg-slate-800 px-2 py-1.5 text-xs text-white"
              >
                {ALL_FACTOR_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {zh ? FACTOR_LABELS[f].zh : FACTOR_LABELS[f].en}
                  </option>
                ))}
              </select>
              <select
                value={c.op}
                onChange={(e) => updateCondition(i, { op: e.target.value })}
                className="w-16 rounded-md border border-white/10 bg-slate-800 px-2 py-1.5 text-xs text-white"
              >
                {OPERATORS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={c.value}
                step="0.05"
                onChange={(e) =>
                  updateCondition(i, { value: parseFloat(e.target.value) || 0 })
                }
                className="w-28 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white"
              />
              <button
                onClick={() => removeCondition(i)}
                className="rounded p-1.5 text-gray-500 hover:bg-red-500/10 hover:text-red-400"
                title={zh ? "删除" : "Remove"}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          {conditions.length === 0 && (
            <p className="py-3 text-center text-[11px] text-gray-500">
              {zh
                ? "无筛选条件 — 将返回全部 SP500"
                : "No conditions — returns all SP500"}
            </p>
          )}
        </div>

        {/* Sort + limit */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div>
            <label className="mb-1 block text-[10px] text-gray-500">
              {zh ? "排序按" : "Sort By"}
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-slate-800 px-2 py-1.5 text-xs text-white"
            >
              {ALL_FACTOR_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {zh ? FACTOR_LABELS[f].zh : FACTOR_LABELS[f].en}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] text-gray-500">
              {zh ? "顺序" : "Order"}
            </label>
            <select
              value={sortDesc ? "desc" : "asc"}
              onChange={(e) => setSortDesc(e.target.value === "desc")}
              className="w-full rounded-md border border-white/10 bg-slate-800 px-2 py-1.5 text-xs text-white"
            >
              <option value="desc">{zh ? "降序" : "Descending"}</option>
              <option value="asc">{zh ? "升序" : "Ascending"}</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] text-gray-500">
              {zh ? "结果数" : "Limit"}
            </label>
            <input
              type="number"
              value={limit}
              min={1}
              max={500}
              onChange={(e) => setLimit(parseInt(e.target.value) || 50)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white"
            />
          </div>
        </div>
      </div>

      {/* Run button */}
      <button
        onClick={run}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-amber-500/20 px-3 py-2.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Filter className="h-3.5 w-3.5" />
        )}
        {loading
          ? zh
            ? "筛选中..."
            : "Screening..."
          : zh
            ? "运行筛选"
            : "Run Screen"}
      </button>

      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Summary */}
          <div className="flex items-baseline justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
            <span className="text-xs font-semibold text-emerald-300">
              {zh
                ? `匹配 ${result.matched} 只股票`
                : `Matched ${result.matched} stocks`}
            </span>
            <span className="text-[10px] text-gray-400">
              {zh ? "全样本" : "Universe"}: {result.total_in_universe}{" "}
              {zh ? "只" : "stocks"}
            </span>
          </div>

          {/* Per-condition diagnostics */}
          {result.applied_conditions.length > 0 && (
            <details className="text-[10px] text-gray-500">
              <summary className="cursor-pointer">
                {zh ? "条件过滤诊断" : "Condition diagnostics"}
              </summary>
              <ul className="mt-1 space-y-0.5">
                {result.applied_conditions.map((d, i) => (
                  <li key={i} className="font-mono">
                    {d.condition.factor} {d.condition.op} {d.condition.value}{" "}
                    {d.before != null && d.after != null ? (
                      <>
                        : {d.before} → {d.after}{" "}
                        <span className="text-amber-400">
                          (-{d.filtered_out})
                        </span>
                      </>
                    ) : (
                      <span className="text-red-400"> [{d.matched}]</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Results table */}
          {result.results.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-[11px]">
                <thead className="bg-white/5 text-gray-400">
                  <tr>
                    <th className="sticky left-0 bg-white/5 px-2 py-2 text-left">
                      {zh ? "代码" : "Symbol"}
                    </th>
                    <th className="px-2 py-2 text-left">
                      {zh ? "行业" : "Sector"}
                    </th>
                    <th className="px-2 py-2 text-right">
                      {zh ? "市值" : "Market Cap"}
                    </th>
                    {displayFactors.map((f) => (
                      <th key={f} className="px-2 py-2 text-right">
                        {zh
                          ? (FACTOR_LABELS[f]?.zh ?? f)
                          : (FACTOR_LABELS[f]?.en ?? f)}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-center"></th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r) => (
                    <tr
                      key={r.symbol}
                      className="border-t border-white/5 hover:bg-white/5"
                    >
                      <td className="sticky left-0 bg-slate-900 px-2 py-1.5 font-mono font-semibold text-cyan-300">
                        {r.symbol}
                      </td>
                      <td className="px-2 py-1.5 text-[10px] text-gray-400">
                        {r.sector ?? "?"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-300">
                        {fmtMarketCap(r.market_cap)}
                      </td>
                      {displayFactors.map((f) => (
                        <td
                          key={f}
                          className="px-2 py-1.5 text-right font-mono text-white"
                        >
                          {fmtFactor(r.factors[f])}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-center">
                        <Link
                          href={`/dashboard/stocks/${r.symbol}`}
                          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-cyan-500/10"
                          title={zh ? "打开工作台" : "Open workbench"}
                        >
                          <ExternalLink className="h-2.5 w-2.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-lg bg-amber-500/10 px-3 py-6 text-center text-xs text-amber-300">
              {zh
                ? "没有股票匹配当前条件，试着放宽阈值"
                : "No matches. Try loosening thresholds."}
            </p>
          )}

          <p className="text-[10px] text-gray-600">
            {zh
              ? "* 因子值为标准化前的原始数据。点击代码进入个股工作台查看完整分析。"
              : "* Raw factor values (pre-standardization). Click symbol for full workbench."}
          </p>
        </>
      )}
    </div>
  );
}
