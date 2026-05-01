"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import {
  SignalDetailPanel,
  type ScoredSignalDict,
} from "@/components/dashboard/SignalDetailPanel";
import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Default symbols if user has no watchlist + no holdings (popular liquid US tickers)
const DEFAULT_SCAN_UNIVERSE = [
  "NVDA",
  "TSLA",
  "AAPL",
  "AMD",
  "GOOGL",
  "META",
  "MSFT",
  "AMZN",
  "NFLX",
  "COIN",
  "SPY",
  "QQQ",
];

// ── Types ──────────────────────────────────────────────────────────────────

interface ScanSummary {
  total_signals: number;
  grade_a: number;
  grade_b: number;
  grade_c: number;
  top_signal: {
    symbol: string;
    strategy_name: string;
    grade: "A" | "B" | "C";
    score: number;
  } | null;
}

interface ScanResult {
  scanned: number;
  results: Record<
    string,
    {
      regime?: string;
      regime_score?: number;
      candidates?: ScoredSignalDict[];
      error?: string;
    }
  >;
  summary: ScanSummary;
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function SignalsPage() {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const [universe, setUniverse] = useState<string[]>([]);
  const [universeSource, setUniverseSource] = useState<
    "loading" | "user" | "default"
  >("loading");
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeUnscored, setIncludeUnscored] = useState(false);
  const [gradeFilter, setGradeFilter] = useState<"all" | "A" | "B" | "C">(
    "all",
  );
  const [strategyFilter, setStrategyFilter] = useState<string>("all");
  const [extraSymbol, setExtraSymbol] = useState("");

  // ── Build universe (Watchlist + Holdings, fallback to defaults) ────────
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        setUniverse(DEFAULT_SCAN_UNIVERSE);
        setUniverseSource("default");
        return;
      }
      const [wl, hd] = await Promise.all([
        supabase
          .from("watchlists")
          .select("symbol")
          .eq("user_id", user.id)
          .limit(50),
        supabase
          .from("portfolio_holdings")
          .select("symbol")
          .eq("user_id", user.id)
          .limit(50),
      ]);
      const set = new Set<string>();
      (wl.data || []).forEach((r: { symbol: string }) => set.add(r.symbol));
      (hd.data || []).forEach((r: { symbol: string }) => set.add(r.symbol));
      const list = Array.from(set);
      if (list.length === 0) {
        setUniverse(DEFAULT_SCAN_UNIVERSE);
        setUniverseSource("default");
      } else {
        setUniverse(list);
        setUniverseSource("user");
      }
    });
  }, []);

  // ── Run scan ───────────────────────────────────────────────────────────
  const runScan = useCallback(
    async (symbols: string[]) => {
      if (symbols.length === 0) return;
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`${API_BASE_URL}/v1/signals/scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbols,
            include_unscored: includeUnscored,
          }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as ScanResult;
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Scan failed");
      } finally {
        setLoading(false);
      }
    },
    [includeUnscored],
  );

  // Auto-scan when universe is ready
  useEffect(() => {
    if (universe.length > 0) {
      runScan(universe);
    }
  }, [universe, runScan]);

  // ── Flatten + filter ───────────────────────────────────────────────────
  const allSignals = useMemo(() => {
    if (!data) return [];
    const flat: ScoredSignalDict[] = [];
    for (const v of Object.values(data.results)) {
      if (v.candidates) flat.push(...v.candidates);
    }
    return flat.sort((a, b) => b.score_total - a.score_total);
  }, [data]);

  const filteredSignals = useMemo(() => {
    return allSignals.filter((s) => {
      if (gradeFilter !== "all" && s.score_grade !== gradeFilter) return false;
      if (strategyFilter !== "all" && s.strategy_name !== strategyFilter)
        return false;
      return true;
    });
  }, [allSignals, gradeFilter, strategyFilter]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-md bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold tracking-wider text-cyan-300 uppercase">
              Trading System v2
            </span>
            <h1 className="text-2xl font-bold text-white">
              {isZh ? "信号中心" : "Signal Center"}
            </h1>
          </div>
          <p className="text-sm text-gray-400">
            {isZh
              ? "4 套规则化策略 × 6 维度评分 — 全市场扫描结果"
              : "4 rule-based strategies × 6-dim scoring — full universe scan"}
          </p>
        </div>
        <button
          onClick={() => runScan(universe)}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {isZh ? "重新扫描" : "Rescan"}
        </button>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <SummaryCard
            label={isZh ? "扫描标的" : "Symbols Scanned"}
            value={data.scanned}
            icon={<Search className="h-4 w-4 text-cyan-400" />}
            tone="cyan"
          />
          <SummaryCard
            label={isZh ? "总信号数" : "Total Signals"}
            value={data.summary.total_signals}
            icon={<Activity className="h-4 w-4 text-amber-400" />}
            tone="amber"
          />
          <SummaryCard
            label="A 级"
            value={data.summary.grade_a}
            icon={<Sparkles className="h-4 w-4 text-emerald-400" />}
            tone="emerald"
          />
          <SummaryCard
            label="B 级"
            value={data.summary.grade_b}
            icon={<Sparkles className="h-4 w-4 text-amber-400" />}
            tone="amber"
          />
          <SummaryCard
            label="C 级"
            value={data.summary.grade_c}
            icon={<Sparkles className="h-4 w-4 text-slate-400" />}
            tone="slate"
          />
        </div>
      )}

      {/* Top signal callout */}
      {data?.summary.top_signal && (
        <div className="rounded-2xl border border-emerald-500/40 bg-gradient-to-r from-emerald-500/10 via-cyan-500/5 to-transparent p-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 text-emerald-400" />
            <div>
              <p className="text-xs font-semibold tracking-wider text-emerald-300 uppercase">
                {isZh ? "今日 Top 信号" : "Top Signal Today"}
              </p>
              <div className="flex items-baseline gap-2">
                <Link
                  href={`/dashboard/stocks/${data.summary.top_signal.symbol}`}
                  className="font-mono text-lg font-bold text-cyan-400 hover:underline"
                >
                  {data.summary.top_signal.symbol}
                </Link>
                <span className="text-sm text-gray-300">
                  {data.summary.top_signal.strategy_name}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    data.summary.top_signal.grade === "A"
                      ? "bg-emerald-500 text-white"
                      : "bg-amber-500 text-white"
                  }`}
                >
                  {data.summary.top_signal.grade}
                </span>
                <span className="font-mono text-sm font-bold text-emerald-400 tabular-nums">
                  {data.summary.top_signal.score.toFixed(1)}/100
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Universe / scan controls */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            <Filter className="h-4 w-4 text-gray-400" />
            <span className="text-gray-400">
              {isZh ? "扫描范围" : "Universe"}:
            </span>
            <span className="font-mono text-cyan-300">
              {universe.length} {isZh ? "只" : "symbols"}
            </span>
            <span className="text-gray-600">
              ·{" "}
              {universeSource === "user"
                ? isZh
                  ? "Watchlist + 持仓"
                  : "Watchlist + Holdings"
                : universeSource === "loading"
                  ? isZh
                    ? "加载中…"
                    : "loading…"
                  : isZh
                    ? "默认大盘股"
                    : "default large caps"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={extraSymbol}
              onChange={(e) => setExtraSymbol(e.target.value.toUpperCase())}
              placeholder={isZh ? "添加标的…" : "Add symbol..."}
              className="w-32 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white placeholder-gray-600"
            />
            <button
              onClick={() => {
                const sym = extraSymbol.trim();
                if (sym && !universe.includes(sym)) {
                  setUniverse([sym, ...universe]);
                  setExtraSymbol("");
                }
              }}
              disabled={!extraSymbol.trim()}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-white/10 disabled:opacity-50"
            >
              +
            </button>
            <label className="flex cursor-pointer items-center gap-1 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={includeUnscored}
                onChange={(e) => setIncludeUnscored(e.target.checked)}
                className="h-3 w-3"
              />
              {isZh ? "含未达标" : "include below-C"}
            </label>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Grade filter */}
          <span className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
            {isZh ? "等级" : "Grade"}:
          </span>
          {(["all", "A", "B", "C"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGradeFilter(g)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                gradeFilter === g
                  ? "bg-cyan-500 text-white"
                  : "bg-white/5 text-gray-300 hover:bg-white/10"
              }`}
            >
              {g === "all" ? (isZh ? "全部" : "All") : g}
            </button>
          ))}
          <span className="ml-3 text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
            {isZh ? "策略" : "Strategy"}:
          </span>
          <select
            value={strategyFilter}
            onChange={(e) => setStrategyFilter(e.target.value)}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"
          >
            <option value="all">{isZh ? "全部" : "All"}</option>
            <option value="trend_pullback_breakout">
              {isZh ? "顺势回调突破" : "Trend Pullback Breakout"}
            </option>
            <option value="wyckoff_liquidity_sweep">
              {isZh ? "流动性扫荡" : "Wyckoff Sweep"}
            </option>
            <option value="ema_squeeze_launch">
              {isZh ? "EMA 蓄势启动" : "EMA Squeeze Launch"}
            </option>
            <option value="bollinger_extreme_reversion">
              {isZh ? "布林极值回归" : "BB Reversion"}
            </option>
          </select>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 py-16">
          <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
          <span className="ml-3 text-sm text-gray-400">
            {isZh
              ? `扫描中…${universe.length} 个标的`
              : `Scanning ${universe.length} symbols…`}
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Signal list */}
      {!loading && data && (
        <div>
          {filteredSignals.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 py-16 text-center">
              <p className="text-sm text-gray-500">
                {isZh
                  ? "当前过滤条件下无信号。试试切换等级或包含未达标信号。"
                  : "No signals match current filters."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {filteredSignals.map((s, i) => (
                <SignalDetailPanel
                  key={`${s.symbol}-${s.strategy_name}-${i}`}
                  signal={s}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <p className="text-[10px] text-gray-600">
        {isZh
          ? "* 信号由规则引擎自动生成 — 不构成投资建议。每次扫描会实时拉取 yfinance 数据 (~1 分钟)。"
          : "* Rule-based signals — not investment advice. Each scan pulls live yfinance data (~1 min)."}
      </p>
    </main>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "cyan" | "amber" | "emerald" | "slate";
}) {
  const colorMap = {
    cyan: "text-cyan-400",
    amber: "text-amber-400",
    emerald: "text-emerald-400",
    slate: "text-slate-400",
  };
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="mb-1 flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
          {label}
        </span>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${colorMap[tone]}`}>
        {value}
      </p>
    </div>
  );
}
