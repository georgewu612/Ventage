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

import { useState, useCallback, useEffect } from "react";
import {
  Filter,
  Plus,
  Trash2,
  Loader2,
  ExternalLink,
  Sparkles,
  Download,
  BookmarkPlus,
  Bookmark,
  Save,
  LineChart,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";

import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

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
  // ── 3 ORTHOGONAL strategies (designed to LOW-correlate with momentum) ──
  {
    key: "reversal",
    zhName: "🔄 短期反转",
    enName: "🔄 Short-Term Reversal",
    zhDesc: "跌惨但不烂的股票 — 反弹概率高。与动量策略反相关，组合用作多元化。",
    enDesc:
      "Stocks that fell hard but aren't garbage — bounce candidates. Negatively correlated with momentum, ideal for diversification.",
    conditions: [
      { factor: "momentum_60d", op: "<=", value: -0.05 },
      { factor: "new_high_52w", op: "<=", value: 0.4 },
      { factor: "rs_vs_spy", op: "<=", value: 0 },
    ],
    sortBy: "new_high_52w",
  },
  {
    key: "defensive",
    zhName: "🛡️ 真正防守",
    enName: "🛡️ True Defensive",
    zhDesc: "低波动 + 中性区间 + 无放量 — 稳定无聊但跌得少。震荡市抗跌。",
    enDesc:
      "Low vol + mid-range + no volume — boring but stable. Defensive in choppy markets.",
    conditions: [
      { factor: "low_vol", op: ">=", value: -0.25 },
      { factor: "new_high_52w", op: ">=", value: 0.4 },
      { factor: "new_high_52w", op: "<=", value: 0.7 },
      { factor: "volume_trend_20d", op: "<=", value: 0 },
    ],
    sortBy: "low_vol",
  },
  {
    key: "early_breakout",
    zhName: "📈 早期突破",
    enName: "📈 Early Breakout",
    zhDesc:
      "刚突破 20 日高点 + 还没冲到 52w 高位 + 量能起来。比三重确认早 30 天入场。",
    enDesc:
      "Just broke 20d high, not yet at 52w high, volume confirming. Catches uptrend ~30d before Triple Confirmation.",
    conditions: [
      { factor: "breakout_20d", op: ">=", value: 0 },
      { factor: "new_high_52w", op: "<=", value: 0.8 },
      { factor: "volume_spike_5d", op: ">=", value: 1.2 },
    ],
    sortBy: "breakout_20d",
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

  // ── Saved screens (localStorage) ─────────────────────────────────────────
  interface SavedScreen {
    name: string;
    conditions: Condition[];
    sortBy: string;
    sortDesc: boolean;
    limit: number;
    createdAt: string;
  }
  const STORAGE_KEY = "ventage:saved_screens";
  const [savedScreens, setSavedScreens] = useState<SavedScreen[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSavedScreens(JSON.parse(raw));
    } catch {}
  }, []);

  const saveCurrentScreen = () => {
    const name = saveName.trim();
    if (!name) return;
    const screen: SavedScreen = {
      name,
      conditions,
      sortBy,
      sortDesc,
      limit,
      createdAt: new Date().toISOString(),
    };
    const next = [...savedScreens.filter((s) => s.name !== name), screen];
    setSavedScreens(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
    setShowSaveDialog(false);
    setSaveName("");
  };

  const loadSavedScreen = (s: SavedScreen) => {
    setConditions(s.conditions);
    setSortBy(s.sortBy);
    setSortDesc(s.sortDesc);
    setLimit(s.limit);
    setActivePreset(null);
  };

  const deleteSavedScreen = (name: string) => {
    if (!confirm(zh ? `删除「${name}」？` : `Delete "${name}"?`)) return;
    const next = savedScreens.filter((s) => s.name !== name);
    setSavedScreens(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  };

  // ── CSV export ────────────────────────────────────────────────────────────
  const exportCSV = () => {
    if (!result || result.results.length === 0) return;
    const factorCols = Array.from(
      new Set(result.results.flatMap((r) => Object.keys(r.factors))),
    );
    const headers = ["symbol", "sector", "market_cap", ...factorCols];
    const rows = result.results.map((r) => [
      r.symbol,
      r.sector ?? "",
      r.market_cap?.toString() ?? "",
      ...factorCols.map((f) => {
        const v = r.factors[f];
        return v == null ? "" : v.toString();
      }),
    ]);
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => {
            const s = String(cell);
            return s.includes(",") || s.includes('"')
              ? `"${s.replace(/"/g, '""')}"`
              : s;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ventage_screener_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Add to Watchlist ─────────────────────────────────────────────────────
  const [watchlistStatus, setWatchlistStatus] = useState<string | null>(null);
  const addAllToWatchlist = async () => {
    if (!result || result.results.length === 0) return;
    setWatchlistStatus(zh ? "添加中..." : "Adding...");
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setWatchlistStatus(zh ? "请先登录" : "Sign in first");
        return;
      }
      const rows = result.results.map((r) => ({
        user_id: user.id,
        symbol: r.symbol,
      }));
      // Upsert by (user_id, symbol) to avoid duplicate-key errors
      const { error } = await supabase
        .from("watchlists")
        .upsert(rows, { onConflict: "user_id,symbol", ignoreDuplicates: true });
      if (error) throw error;
      setWatchlistStatus(
        zh
          ? `✅ 已添加 ${rows.length} 只到自选`
          : `✅ Added ${rows.length} to watchlist`,
      );
      setTimeout(() => setWatchlistStatus(null), 3000);
    } catch (e) {
      setWatchlistStatus(`⚠️ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ── Backtest ────────────────────────────────────────────────────────────
  interface BacktestResult {
    n_symbols: number;
    n_periods: number;
    annualized_return_pct: number;
    annualized_vol_pct: number;
    sharpe_ratio: number;
    max_drawdown_pct: number;
    win_rate_pct: number;
    alpha_vs_benchmark_annual_pct: number;
    information_ratio: number;
    cumulative_curve: { date: string; portfolio: number; benchmark: number }[];
    warning: string;
  }
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestLookback, setBacktestLookback] = useState(24);

  const runBacktest = async () => {
    if (!result || result.results.length === 0) return;
    setBacktestLoading(true);
    setBacktest(null);
    try {
      const r = await fetch(`${API_BASE_URL}/v1/factors/screener/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: result.results.map((x) => x.symbol),
          lookback_months: backtestLookback,
          benchmark: "SPY",
        }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? `HTTP ${r.status}`);
      setBacktest(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBacktestLoading(false);
    }
  };

  // ── PIT (true point-in-time) backtest ─────────────────────────────────
  interface PITBacktestResult {
    n_snapshots_used: number;
    snapshot_dates: string[];
    period_returns: {
      date: string;
      n_matched: number;
      return_pct: number;
      benchmark_pct: number;
      sample_symbols: string[];
    }[];
    annualized_return_pct: number;
    annualized_vol_pct: number;
    sharpe_ratio: number;
    max_drawdown_pct: number;
    win_rate_pct: number;
    cumulative_curve: { date: string; portfolio: number; benchmark: number }[];
    benchmark_annualized_pct: number;
    alpha_annual_pct: number;
    information_ratio: number;
    avg_holdings: number;
    interpretation: string;
    warnings: string[];
  }
  const [pitBacktest, setPitBacktest] = useState<PITBacktestResult | null>(
    null,
  );
  const [pitLoading, setPitLoading] = useState(false);
  const [pitError, setPitError] = useState<string | null>(null);

  const runPitBacktest = async () => {
    setPitLoading(true);
    setPitBacktest(null);
    setPitError(null);
    try {
      const r = await fetch(
        `${API_BASE_URL}/v1/factors/screener/backtest/pit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conditions,
            benchmark: "SPY",
            min_holdings: 5,
          }),
        },
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${r.status}`);
      }
      setPitBacktest(await r.json());
    } catch (e) {
      setPitError(e instanceof Error ? e.message : String(e));
    } finally {
      setPitLoading(false);
    }
  };

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
      {/* Saved screens (localStorage) */}
      {savedScreens.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-cyan-300">
            <Bookmark className="h-3 w-3" />
            {zh ? "我的已保存策略" : "My Saved Screens"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {savedScreens.map((s) => (
              <div
                key={s.name}
                className="flex items-center gap-1 rounded-md border border-cyan-500/20 bg-cyan-500/5 pl-2"
              >
                <button
                  onClick={() => loadSavedScreen(s)}
                  className="text-[11px] text-cyan-300 hover:text-cyan-200"
                  title={zh ? "加载这个策略" : "Load this screen"}
                >
                  {s.name}
                  <span className="ml-1.5 text-[9px] text-gray-500">
                    ({s.conditions.length} {zh ? "条件" : "cond"})
                  </span>
                </button>
                <button
                  onClick={() => deleteSavedScreen(s.name)}
                  className="rounded-r-md p-1 text-gray-600 hover:bg-red-500/10 hover:text-red-400"
                  title={zh ? "删除" : "Delete"}
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowSaveDialog(true)}
              className="flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[10px] text-violet-300 hover:bg-violet-500/20"
              title={
                zh ? "保存当前条件为我的策略" : "Save current as my strategy"
              }
            >
              <Save className="h-3 w-3" />
              {zh ? "保存" : "Save"}
            </button>
            <button
              onClick={addCondition}
              className="flex items-center gap-1 rounded bg-cyan-500/20 px-2 py-1 text-[10px] text-cyan-300 hover:bg-cyan-500/30"
            >
              <Plus className="h-3 w-3" />
              {zh ? "添加" : "Add"}
            </button>
          </div>
        </div>

        {/* Save dialog */}
        {showSaveDialog && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-violet-500/30 bg-violet-500/5 p-2">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveCurrentScreen()}
              placeholder={
                zh ? "策略名称（如：我的动量+质量）" : "Strategy name"
              }
              className="flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"
              autoFocus
            />
            <button
              onClick={saveCurrentScreen}
              disabled={!saveName.trim()}
              className="rounded-md bg-violet-500/30 px-3 py-1 text-xs font-medium text-violet-200 hover:bg-violet-500/40 disabled:opacity-50"
            >
              {zh ? "保存" : "Save"}
            </button>
            <button
              onClick={() => {
                setShowSaveDialog(false);
                setSaveName("");
              }}
              className="rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-white/5"
            >
              {zh ? "取消" : "Cancel"}
            </button>
          </div>
        )}

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

          {/* Action bar: Export / Watchlist / Backtest */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10"
            >
              <Download className="h-3.5 w-3.5" />
              {zh ? "导出 CSV" : "Export CSV"}
            </button>
            <button
              onClick={addAllToWatchlist}
              className="flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-300 hover:bg-cyan-500/20"
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              {zh
                ? `加入自选（${result.results.length}）`
                : `Add to Watchlist (${result.results.length})`}
            </button>
            <div className="ml-auto flex items-center gap-2">
              <input
                type="number"
                value={backtestLookback}
                min={3}
                max={60}
                onChange={(e) =>
                  setBacktestLookback(parseInt(e.target.value) || 24)
                }
                className="w-16 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"
                title={zh ? "回看月数" : "Lookback months"}
              />
              <button
                onClick={runBacktest}
                disabled={backtestLoading}
                className="flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-300 hover:bg-violet-500/20 disabled:opacity-50"
                title={
                  zh
                    ? "假设持有当前组合 N 月（有 look-ahead bias）"
                    : "Held-current backtest (has look-ahead bias)"
                }
              >
                {backtestLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LineChart className="h-3.5 w-3.5" />
                )}
                {zh ? "假设回测" : "Naive Backtest"}
              </button>
              <button
                onClick={runPitBacktest}
                disabled={pitLoading}
                className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                title={
                  zh
                    ? "真实点-在-时刻回测（无 look-ahead bias，需 ≥2 份月度快照）"
                    : "True point-in-time backtest (no look-ahead bias, needs ≥2 monthly snapshots)"
                }
              >
                {pitLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <span className="text-base">⭐</span>
                )}
                {zh ? "PIT 真回测" : "PIT Backtest"}
              </button>
            </div>
          </div>

          {/* Watchlist status toast */}
          {watchlistStatus && (
            <p className="rounded-md bg-cyan-500/10 px-3 py-1.5 text-[11px] text-cyan-300">
              {watchlistStatus}
            </p>
          )}

          {/* PIT backtest error (often: "need ≥2 snapshots") */}
          {pitError && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <p className="text-[11px] font-semibold text-amber-300">
                {zh ? "⚠️ PIT 回测无法运行" : "⚠️ PIT backtest unavailable"}
              </p>
              <p className="mt-0.5 text-[10px] text-amber-200">{pitError}</p>
              <p className="mt-1 text-[10px] text-gray-400">
                {zh
                  ? "解决方法：去状态条点「立即拍照」积累更多月度快照。每月 1 号自动拍。"
                  : "Fix: trigger 'Snapshot Now' in the status bar to accumulate more monthly snapshots. Auto-runs on the 1st of each month."}
              </p>
            </div>
          )}

          {/* Naive backtest results */}
          {backtest && <BacktestPanel data={backtest} zh={zh} />}

          {/* PIT backtest results */}
          {pitBacktest && <PITBacktestResultPanel data={pitBacktest} zh={zh} />}

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

// ── Backtest sub-component ──────────────────────────────────────────────────

function BacktestPanel({
  data,
  zh,
}: {
  data: {
    n_symbols: number;
    n_periods: number;
    annualized_return_pct: number;
    annualized_vol_pct: number;
    sharpe_ratio: number;
    max_drawdown_pct: number;
    win_rate_pct: number;
    alpha_vs_benchmark_annual_pct: number;
    information_ratio: number;
    cumulative_curve: { date: string; portfolio: number; benchmark: number }[];
    warning: string;
  };
  zh: boolean;
}) {
  const curve = data.cumulative_curve;
  if (!curve || curve.length < 2) return null;

  const w = 600;
  const h = 200;
  const pad = 36;
  const dateY = h - 6;
  const chartTop = pad - 12;
  const chartBottom = h - pad - 18;

  const xs = curve.map(
    (_, i) => pad + (i / (curve.length - 1)) * (w - 2 * pad),
  );
  const allValues = curve.flatMap((c) => [c.portfolio, c.benchmark]);
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const yRange = yMax - yMin || 1;
  const y = (v: number) =>
    chartBottom - ((v - yMin) / yRange) * (chartBottom - chartTop);

  const linePath = (key: "portfolio" | "benchmark") =>
    curve
      .map(
        (c, i) =>
          `${i === 0 ? "M" : "L"} ${xs[i].toFixed(1)} ${y(c[key]).toFixed(1)}`,
      )
      .join(" ");

  const tone = (
    v: number,
    cmp: ">0" | "<0" | "abs>1" | "abs>0.5",
  ): "good" | "bad" | "neutral" => {
    if (cmp === ">0") return v > 0 ? "good" : v < 0 ? "bad" : "neutral";
    if (cmp === "<0") return v > 0 ? "bad" : "good";
    if (cmp === "abs>1") return Math.abs(v) > 1 ? "good" : "neutral";
    return Math.abs(v) > 0.5 ? "good" : "neutral";
  };
  const toneCls = {
    good: "text-emerald-300 bg-emerald-500/10",
    bad: "text-red-300 bg-red-500/10",
    neutral: "text-gray-300 bg-white/5",
  };

  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
      <p className="mb-2 text-xs font-semibold text-violet-300">
        {zh
          ? `🔬 假设持有当前 ${data.n_symbols} 只股票（等权重，过去 ${data.n_periods} 个月）`
          : `🔬 If you'd held this ${data.n_symbols}-stock set (equal-weight, past ${data.n_periods} months)`}
      </p>

      {/* Honest warning */}
      <div className="mb-3 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
        <p className="text-[10px] text-amber-300">
          {zh
            ? "这不是真正的滚动调仓回测——我们没有历史因子快照。这只是「如果当时持有当前这套股票」的事后回顾。Sharpe 数字不能用作未来收益预测。"
            : data.warning}
        </p>
      </div>

      {/* Stats grid */}
      <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat
          label={zh ? "年化收益" : "Annual Ret"}
          value={`${data.annualized_return_pct >= 0 ? "+" : ""}${data.annualized_return_pct.toFixed(1)}%`}
          tone={tone(data.annualized_return_pct, ">0")}
        />
        <Stat
          label="Sharpe"
          value={data.sharpe_ratio.toFixed(2)}
          tone={tone(data.sharpe_ratio, "abs>1")}
        />
        <Stat
          label={zh ? "最大回撤" : "Max DD"}
          value={`-${data.max_drawdown_pct.toFixed(1)}%`}
          tone={
            data.max_drawdown_pct < 15
              ? "good"
              : data.max_drawdown_pct < 25
                ? "neutral"
                : "bad"
          }
        />
        <Stat
          label={zh ? "胜率" : "Win Rate"}
          value={`${data.win_rate_pct.toFixed(0)}%`}
          tone={
            data.win_rate_pct >= 55
              ? "good"
              : data.win_rate_pct < 45
                ? "bad"
                : "neutral"
          }
        />
        <Stat
          label={zh ? "α vs SPY" : "α vs SPY"}
          value={`${data.alpha_vs_benchmark_annual_pct >= 0 ? "+" : ""}${data.alpha_vs_benchmark_annual_pct.toFixed(1)}%`}
          tone={tone(data.alpha_vs_benchmark_annual_pct, ">0")}
        />
        <Stat
          label="IR"
          value={data.information_ratio.toFixed(2)}
          tone={tone(data.information_ratio, "abs>0.5")}
        />
      </div>

      {/* Chart: portfolio vs benchmark */}
      <svg width="100%" viewBox={`0 0 ${w} ${h}`}>
        {/* Baseline 1.0 */}
        <line
          x1={pad}
          y1={y(1)}
          x2={w - pad}
          y2={y(1)}
          stroke="rgba(255,255,255,0.15)"
          strokeDasharray="3 3"
        />
        {/* Benchmark line (SPY) */}
        <path
          d={linePath("benchmark")}
          fill="none"
          stroke="rgb(107,114,128)"
          strokeWidth="1.5"
        />
        {/* Portfolio line */}
        <path
          d={linePath("portfolio")}
          fill="none"
          stroke="rgb(167,139,250)"
          strokeWidth="2"
        />

        {/* Y-axis labels with anti-overlap: skip 1.00 when too close to yMin/yMax */}
        {(() => {
          const yMaxPos = chartTop + 4;
          const yMinPos = chartBottom + 4;
          const yOnePos = y(1) + 3;
          // Hide 1.00 label if within 12px of either edge label
          const showOne =
            Math.abs(yOnePos - yMaxPos) > 12 &&
            Math.abs(yOnePos - yMinPos) > 12;
          return (
            <>
              <text
                x={pad - 4}
                y={yMaxPos}
                textAnchor="end"
                className="fill-gray-600 text-[9px]"
              >
                {yMax.toFixed(2)}
              </text>
              <text
                x={pad - 4}
                y={yMinPos}
                textAnchor="end"
                className="fill-gray-600 text-[9px]"
              >
                {yMin.toFixed(2)}
              </text>
              {showOne && (
                <text
                  x={pad - 4}
                  y={yOnePos}
                  textAnchor="end"
                  className="fill-gray-700 text-[9px]"
                >
                  1.00
                </text>
              )}
            </>
          );
        })()}

        {/* Date labels */}
        <text
          x={xs[0]}
          y={dateY}
          textAnchor="start"
          className="fill-gray-600 text-[9px]"
        >
          {curve[0].date}
        </text>
        {curve.length >= 5 && (
          <text
            x={xs[Math.floor(curve.length / 2)]}
            y={dateY}
            textAnchor="middle"
            className="fill-gray-600 text-[9px]"
          >
            {curve[Math.floor(curve.length / 2)].date}
          </text>
        )}
        <text
          x={xs[curve.length - 1]}
          y={dateY}
          textAnchor="end"
          className="fill-gray-600 text-[9px]"
        >
          {curve[curve.length - 1].date}
        </text>
      </svg>

      <div className="mt-2 flex justify-end gap-3 text-[10px]">
        <span className="text-violet-400">━ {zh ? "组合" : "Portfolio"}</span>
        <span className="text-gray-500">━ SPY</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "bad" | "neutral";
}) {
  const cls = {
    good: "text-emerald-300 bg-emerald-500/10",
    bad: "text-red-300 bg-red-500/10",
    neutral: "text-gray-300 bg-white/5",
  }[tone];
  return (
    <div className={`rounded-md px-2 py-1.5 text-center ${cls}`}>
      <p className="text-[9px] opacity-70">{label}</p>
      <p className="font-mono text-sm font-bold">{value}</p>
    </div>
  );
}

// ── PIT (Point-In-Time) Backtest Panel — TRUE OOS, no look-ahead bias ──

function PITBacktestResultPanel({
  data,
  zh,
}: {
  data: {
    n_snapshots_used: number;
    snapshot_dates: string[];
    period_returns: {
      date: string;
      n_matched: number;
      return_pct: number;
      benchmark_pct: number;
      sample_symbols: string[];
    }[];
    annualized_return_pct: number;
    annualized_vol_pct: number;
    sharpe_ratio: number;
    max_drawdown_pct: number;
    win_rate_pct: number;
    cumulative_curve: { date: string; portfolio: number; benchmark: number }[];
    benchmark_annualized_pct: number;
    alpha_annual_pct: number;
    information_ratio: number;
    avg_holdings: number;
    interpretation: string;
    warnings: string[];
  };
  zh: boolean;
}) {
  const curve = data.cumulative_curve;
  const robust = data.n_snapshots_used >= 6;

  const tone = (
    v: number,
    cmp: ">0" | "abs>1" | "abs>0.5",
  ): "good" | "bad" | "neutral" => {
    if (cmp === ">0") return v > 0 ? "good" : v < 0 ? "bad" : "neutral";
    if (cmp === "abs>1") return Math.abs(v) > 1 ? "good" : "neutral";
    return Math.abs(v) > 0.5 ? "good" : "neutral";
  };

  return (
    <div
      className={`rounded-lg border p-3 ${
        robust
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-amber-500/30 bg-amber-500/5"
      }`}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <p
          className={`text-xs font-semibold ${
            robust ? "text-emerald-300" : "text-amber-300"
          }`}
        >
          ⭐ {zh ? "PIT 真回测" : "PIT Backtest (true OOS)"} —{" "}
          {data.n_snapshots_used} {zh ? "份月度快照" : "monthly snapshots"}
          {!robust && (
            <span className="ml-2 text-[10px] font-normal">
              ({zh ? "需 ≥6 份才稳健" : "needs ≥6 for robust"})
            </span>
          )}
        </p>
        <span className="text-[10px] text-gray-500">
          {data.snapshot_dates[0]} →{" "}
          {data.snapshot_dates[data.snapshot_dates.length - 1]}
        </span>
      </div>

      <div className="mb-3 rounded-md bg-emerald-500/10 px-2 py-1.5">
        <p className="text-[10px] text-emerald-200">
          ✅{" "}
          {zh
            ? "每个月用当时的因子值重新筛选 → 持有 1 月 → 再次筛选。无 look-ahead bias。"
            : "Re-screens at each historical month-end using factor values known THEN, holds 1 month, repeats. No look-ahead bias."}
        </p>
      </div>

      {/* Stats grid */}
      <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat
          label={zh ? "年化收益" : "Annual Ret"}
          value={`${data.annualized_return_pct >= 0 ? "+" : ""}${data.annualized_return_pct.toFixed(1)}%`}
          tone={tone(data.annualized_return_pct, ">0")}
        />
        <Stat
          label="Sharpe"
          value={data.sharpe_ratio.toFixed(2)}
          tone={tone(data.sharpe_ratio, "abs>1")}
        />
        <Stat
          label={zh ? "最大回撤" : "Max DD"}
          value={`-${data.max_drawdown_pct.toFixed(1)}%`}
          tone={
            data.max_drawdown_pct < 15
              ? "good"
              : data.max_drawdown_pct < 25
                ? "neutral"
                : "bad"
          }
        />
        <Stat
          label={zh ? "胜率" : "Win Rate"}
          value={`${data.win_rate_pct.toFixed(0)}%`}
          tone={
            data.win_rate_pct >= 55
              ? "good"
              : data.win_rate_pct < 45
                ? "bad"
                : "neutral"
          }
        />
        <Stat
          label={zh ? "α vs SPY" : "α vs SPY"}
          value={`${data.alpha_annual_pct >= 0 ? "+" : ""}${data.alpha_annual_pct.toFixed(1)}%`}
          tone={tone(data.alpha_annual_pct, ">0")}
        />
        <Stat
          label="IR"
          value={data.information_ratio.toFixed(2)}
          tone={tone(data.information_ratio, "abs>0.5")}
        />
      </div>

      {/* Equity curve */}
      {curve.length >= 2 && <PITCurveChart curve={curve} zh={zh} />}

      {/* Per-period table */}
      <details className="mt-3 text-[10px]">
        <summary className="cursor-pointer text-gray-400">
          {zh ? "📅 各月详情" : "📅 Monthly details"} (
          {data.period_returns.length})
        </summary>
        <div className="mt-2 overflow-x-auto rounded-md border border-white/10">
          <table className="w-full text-[10px]">
            <thead className="bg-white/5 text-gray-400">
              <tr>
                <th className="px-2 py-1.5 text-left">
                  {zh ? "日期" : "Date"}
                </th>
                <th className="px-2 py-1.5 text-right">{zh ? "持仓" : "N"}</th>
                <th className="px-2 py-1.5 text-right">
                  {zh ? "收益" : "Return"}
                </th>
                <th className="px-2 py-1.5 text-right">SPY</th>
                <th className="px-2 py-1.5 text-right">α</th>
                <th className="px-2 py-1.5 text-left">
                  {zh ? "样本持仓" : "Sample"}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.period_returns.map((p, i) => {
                const alpha = p.return_pct - p.benchmark_pct;
                return (
                  <tr key={i} className="border-t border-white/5">
                    <td className="px-2 py-1 text-gray-400">{p.date}</td>
                    <td className="px-2 py-1 text-right text-white">
                      {p.n_matched}
                    </td>
                    <td
                      className={`px-2 py-1 text-right font-mono ${
                        p.return_pct >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {p.return_pct >= 0 ? "+" : ""}
                      {p.return_pct.toFixed(2)}%
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-gray-400">
                      {p.benchmark_pct >= 0 ? "+" : ""}
                      {p.benchmark_pct.toFixed(2)}%
                    </td>
                    <td
                      className={`px-2 py-1 text-right font-mono ${
                        alpha >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {alpha >= 0 ? "+" : ""}
                      {alpha.toFixed(2)}%
                    </td>
                    <td className="px-2 py-1 font-mono text-cyan-300">
                      {p.sample_symbols.slice(0, 4).join(", ")}
                      {p.sample_symbols.length >= 4 && "..."}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {data.warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-amber-300">
              {w}
            </p>
          ))}
        </div>
      )}

      <p className="mt-2 text-[11px] text-emerald-200">
        💡 {data.interpretation}
      </p>
    </div>
  );
}

function PITCurveChart({
  curve,
  zh,
}: {
  curve: { date: string; portfolio: number; benchmark: number }[];
  zh: boolean;
}) {
  const w = 600;
  const h = 180;
  const pad = 36;
  const dateY = h - 6;
  const chartTop = pad - 12;
  const chartBottom = h - pad - 18;

  const xs = curve.map(
    (_, i) => pad + (i / Math.max(curve.length - 1, 1)) * (w - 2 * pad),
  );
  const allValues = curve.flatMap((c) => [c.portfolio, c.benchmark]);
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const yRange = yMax - yMin || 1;
  const y = (v: number) =>
    chartBottom - ((v - yMin) / yRange) * (chartBottom - chartTop);

  const linePath = (key: "portfolio" | "benchmark") =>
    curve
      .map(
        (c, i) =>
          `${i === 0 ? "M" : "L"} ${xs[i].toFixed(1)} ${y(c[key]).toFixed(1)}`,
      )
      .join(" ");

  const yMaxPos = chartTop + 4;
  const yMinPos = chartBottom + 4;
  const yOnePos = y(1) + 3;
  const showOne =
    Math.abs(yOnePos - yMaxPos) > 12 && Math.abs(yOnePos - yMinPos) > 12;

  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-2">
      <p className="mb-1 text-[10px] font-semibold text-gray-400">
        {zh ? "权益曲线（PIT 重组合）" : "PIT Equity Curve"}
      </p>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`}>
        <line
          x1={pad}
          y1={y(1)}
          x2={w - pad}
          y2={y(1)}
          stroke="rgba(255,255,255,0.15)"
          strokeDasharray="3 3"
        />
        <path
          d={linePath("benchmark")}
          fill="none"
          stroke="rgb(107,114,128)"
          strokeWidth="1.5"
        />
        <path
          d={linePath("portfolio")}
          fill="none"
          stroke="rgb(52,211,153)"
          strokeWidth="2"
        />

        <text
          x={pad - 4}
          y={yMaxPos}
          textAnchor="end"
          className="fill-gray-600 text-[9px]"
        >
          {yMax.toFixed(2)}
        </text>
        <text
          x={pad - 4}
          y={yMinPos}
          textAnchor="end"
          className="fill-gray-600 text-[9px]"
        >
          {yMin.toFixed(2)}
        </text>
        {showOne && (
          <text
            x={pad - 4}
            y={yOnePos}
            textAnchor="end"
            className="fill-gray-700 text-[9px]"
          >
            1.00
          </text>
        )}
        <text
          x={xs[0]}
          y={dateY}
          textAnchor="start"
          className="fill-gray-600 text-[9px]"
        >
          {curve[0].date}
        </text>
        {curve.length >= 5 && (
          <text
            x={xs[Math.floor(curve.length / 2)]}
            y={dateY}
            textAnchor="middle"
            className="fill-gray-600 text-[9px]"
          >
            {curve[Math.floor(curve.length / 2)].date}
          </text>
        )}
        <text
          x={xs[curve.length - 1]}
          y={dateY}
          textAnchor="end"
          className="fill-gray-600 text-[9px]"
        >
          {curve[curve.length - 1].date}
        </text>
      </svg>
      <div className="flex justify-end gap-3 text-[10px]">
        <span className="text-emerald-400">
          ━ {zh ? "PIT 组合" : "PIT Portfolio"}
        </span>
        <span className="text-gray-500">━ SPY</span>
      </div>
    </div>
  );
}
