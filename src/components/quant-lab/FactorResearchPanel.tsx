"use client";

/**
 * Factor Research Workshop — 4 sub-tabs:
 *   1. Universe — refresh cache + browse cached panel
 *   2. Cross-Section Sort — n-bin sort + H-L spread
 *   3. Fama-MacBeth — multi-factor regression with t-stats
 *   4. Long-Short Backtest — equity curve + Sharpe / DD
 *
 * Plus shared header showing universe cache status.
 *
 * All endpoints are POST/GET under /v1/factors/research/*
 */

import { useState, useCallback, useEffect } from "react";
import {
  RefreshCw,
  TrendingUp,
  Calculator,
  LineChart,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Database,
} from "lucide-react";

import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";

type SubTab = "universe" | "sort" | "fama_macbeth" | "backtest";
type FactorName =
  | "value"
  | "quality"
  | "momentum"
  | "size"
  | "low_vol"
  | "low_inv";

const FACTOR_LABELS: Record<FactorName, { zh: string; en: string }> = {
  value: { zh: "价值", en: "Value" },
  quality: { zh: "质量", en: "Quality" },
  momentum: { zh: "动量", en: "Momentum" },
  size: { zh: "小盘", en: "Size" },
  low_vol: { zh: "低波动", en: "Low Vol" },
  low_inv: { zh: "低投资", en: "Low Inv" },
};

const FACTOR_LIST: FactorName[] = [
  "value",
  "quality",
  "momentum",
  "size",
  "low_vol",
  "low_inv",
];

// ── Status header ──────────────────────────────────────────────────────────

function StatusHeader({
  status,
  refreshing,
  onRefresh,
  zh,
}: {
  status: {
    fresh_rows: number;
    total_rows: number;
    default_universe_size: number;
  } | null;
  refreshing: boolean;
  onRefresh: () => void;
  zh: boolean;
}) {
  const fresh = status?.fresh_rows ?? 0;
  const total = status?.default_universe_size ?? 50;
  const pctFresh = (fresh / (total * 6)) * 100;
  const isReady = pctFresh >= 80;

  return (
    <div className="mb-4 flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-3">
        <Database className="h-4 w-4 text-cyan-400" />
        <div>
          <p className="text-xs font-medium text-white">
            {zh ? "因子缓存状态" : "Factor Cache"}
          </p>
          <p className="text-[10px] text-gray-500">
            {zh
              ? `${fresh} / ${total * 6} 条新鲜因子值（${total} 只股 × 6 因子）`
              : `${fresh} / ${total * 6} fresh values (${total} symbols × 6 factors)`}
          </p>
        </div>
        {isReady ? (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            {zh ? "就绪" : "Ready"}
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
            <AlertCircle className="h-3 w-3" />
            {zh ? "需刷新" : "Needs refresh"}
          </span>
        )}
      </div>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="flex items-center gap-2 rounded-lg bg-cyan-500/20 px-3 py-1.5 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-500/30 disabled:opacity-50"
      >
        {refreshing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {refreshing
          ? zh
            ? "计算中（约 3-5 分钟）..."
            : "Computing (3-5 min)..."
          : zh
            ? "刷新缓存"
            : "Refresh"}
      </button>
    </div>
  );
}

// ── Tab 1: Universe ────────────────────────────────────────────────────────

function UniversePanel({ zh }: { zh: boolean }) {
  const [data, setData] = useState<{
    symbols: string[];
    factors: Record<string, (number | null)[]>;
    sectors: string[];
    market_caps: (number | null)[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE_URL}/v1/factors/research/panel`);
      if (r.ok) setData(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <p className="text-xs text-gray-500">{zh ? "加载中..." : "Loading..."}</p>
    );
  if (!data || data.symbols.length === 0) {
    return (
      <p className="rounded-lg bg-amber-500/10 px-3 py-3 text-xs text-amber-300">
        {zh
          ? "缓存为空。请先点击右上角「刷新缓存」按钮"
          : "Cache empty. Click Refresh above."}
      </p>
    );
  }

  return (
    <div>
      <p className="mb-3 text-xs text-gray-400">
        {zh
          ? `共 ${data.symbols.length} 只股票的 6 维因子值（按市值排序）`
          : `${data.symbols.length} symbols × 6 factors (sorted by market cap)`}
      </p>
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-[11px]">
          <thead className="bg-white/5 text-gray-400">
            <tr>
              <th className="px-2 py-2 text-left">{zh ? "代码" : "Symbol"}</th>
              <th className="px-2 py-2 text-left">{zh ? "行业" : "Sector"}</th>
              {FACTOR_LIST.map((f) => (
                <th key={f} className="px-2 py-2 text-right">
                  {zh ? FACTOR_LABELS[f].zh : FACTOR_LABELS[f].en}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.symbols.map((sym, i) => (
              <tr
                key={sym}
                className="border-t border-white/5 hover:bg-white/5"
              >
                <td className="px-2 py-1.5 font-mono font-semibold text-cyan-300">
                  {sym}
                </td>
                <td className="px-2 py-1.5 text-gray-400">{data.sectors[i]}</td>
                {FACTOR_LIST.map((f) => {
                  const v = data.factors[f]?.[i];
                  return (
                    <td
                      key={f}
                      className="px-2 py-1.5 text-right font-mono text-gray-300"
                    >
                      {v == null ? "—" : v.toFixed(3)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab 2: Cross-Section Sort ──────────────────────────────────────────────

function SortPanel({ zh }: { zh: boolean }) {
  const [factor, setFactor] = useState<FactorName>("value");
  const [nBins, setNBins] = useState(5);
  const [lookback, setLookback] = useState(12);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    bins: {
      bin_id: number;
      avg_factor: number;
      avg_return: number;
      n_symbols: number;
      symbols: string[];
    }[];
    high_minus_low_return: number;
    spread_t_stat: number;
    spread_p_value: number;
    monotonic_corr: number;
    interpretation: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE_URL}/v1/factors/research/sort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factor_name: factor,
          n_bins: nBins,
          lookback_months: lookback,
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
  }, [factor, nBins, lookback]);

  // Find max return for bar scaling
  const maxRet = result
    ? Math.max(...result.bins.map((b) => Math.abs(b.avg_return)), 0.1)
    : 1;

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-[10px] text-gray-500">
            {zh ? "因子" : "Factor"}
          </label>
          <select
            value={factor}
            onChange={(e) => setFactor(e.target.value as FactorName)}
            className="rounded-md border border-white/10 bg-slate-800 px-2 py-1.5 text-xs text-white"
          >
            {FACTOR_LIST.map((f) => (
              <option key={f} value={f}>
                {zh ? FACTOR_LABELS[f].zh : FACTOR_LABELS[f].en}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-gray-500">
            {zh ? "分组数" : "Bins"}
          </label>
          <input
            type="number"
            value={nBins}
            min={3}
            max={10}
            onChange={(e) => setNBins(parseInt(e.target.value) || 5)}
            className="w-20 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-gray-500">
            {zh ? "回看月数" : "Lookback (mo)"}
          </label>
          <input
            type="number"
            value={lookback}
            min={3}
            max={60}
            onChange={(e) => setLookback(parseInt(e.target.value) || 12)}
            className="w-20 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white"
          />
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <TrendingUp className="h-3.5 w-3.5" />
          )}
          {zh ? "运行排序" : "Run Sort"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}

      {result && (
        <>
          {/* Spread stats */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-violet-500/10 px-3 py-2">
              <p className="text-[10px] text-gray-500">
                {zh ? "H-L 月均收益" : "H-L Monthly"}
              </p>
              <p className="font-mono text-lg font-bold text-violet-300">
                {result.high_minus_low_return >= 0 ? "+" : ""}
                {result.high_minus_low_return.toFixed(2)}%
              </p>
            </div>
            <div
              className={`rounded-lg px-3 py-2 ${
                Math.abs(result.spread_t_stat) >= 2
                  ? "bg-emerald-500/10"
                  : "bg-white/5"
              }`}
            >
              <p className="text-[10px] text-gray-500">
                t-{zh ? "值（NW 调整）" : "stat (NW)"}
              </p>
              <p
                className={`font-mono text-lg font-bold ${
                  Math.abs(result.spread_t_stat) >= 2
                    ? "text-emerald-300"
                    : "text-gray-300"
                }`}
              >
                {result.spread_t_stat.toFixed(2)}
              </p>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <p className="text-[10px] text-gray-500">
                {zh ? "Spearman ρ" : "Monotonicity ρ"}
              </p>
              <p className="font-mono text-lg font-bold text-cyan-300">
                {result.monotonic_corr.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Bin histogram */}
          <div>
            <p className="mb-2 text-[11px] font-semibold text-gray-400">
              {zh
                ? "各档月均收益（按因子值升序排列）"
                : "Avg Monthly Return by Bin (low→high factor value)"}
            </p>
            <div className="space-y-1">
              {result.bins.map((b) => {
                const pct = (Math.abs(b.avg_return) / maxRet) * 100;
                const isPos = b.avg_return >= 0;
                return (
                  <div key={b.bin_id} className="flex items-center gap-2">
                    <span className="w-12 text-[10px] text-gray-400">
                      {zh ? "档" : "Bin"} {b.bin_id}
                    </span>
                    <div className="flex h-5 flex-1 items-center overflow-hidden rounded bg-white/5">
                      <div
                        className={`h-full ${isPos ? "bg-emerald-500/60" : "bg-red-500/60"}`}
                        style={{ width: `${pct}%` }}
                      />
                      <span className="ml-2 font-mono text-[10px] text-white">
                        {isPos ? "+" : ""}
                        {b.avg_return.toFixed(2)}%
                      </span>
                    </div>
                    <span className="w-12 text-right text-[10px] text-gray-500">
                      n={b.n_symbols}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Interpretation */}
          <p className="rounded-lg bg-violet-500/5 px-3 py-2 text-[11px] text-violet-300">
            💡 {result.interpretation}
          </p>
        </>
      )}
    </div>
  );
}

// ── Tab 3: Fama-MacBeth ────────────────────────────────────────────────────

function FamaMacBethPanel({ zh }: { zh: boolean }) {
  const [lookback, setLookback] = useState(24);
  const [lags, setLags] = useState(6);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    n_periods: number;
    n_symbols_avg: number;
    factors: {
      factor_name: string;
      avg_premium: number;
      t_stat: number;
      p_value: number;
      impact_coefficient: number;
      is_significant: boolean;
    }[];
    interpretation: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `${API_BASE_URL}/v1/factors/research/fama-macbeth`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lookback_months: lookback,
            newey_west_lags: lags,
          }),
        },
      );
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
  }, [lookback, lags]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-[10px] text-gray-500">
            {zh ? "回看月数" : "Lookback (mo)"}
          </label>
          <input
            type="number"
            value={lookback}
            min={6}
            max={60}
            onChange={(e) => setLookback(parseInt(e.target.value) || 24)}
            className="w-20 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-gray-500">
            {zh ? "NW 滞后阶" : "NW Lags"}
          </label>
          <input
            type="number"
            value={lags}
            min={1}
            max={12}
            onChange={(e) => setLags(parseInt(e.target.value) || 6)}
            className="w-20 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white"
          />
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Calculator className="h-3.5 w-3.5" />
          )}
          {zh ? "运行 FM 回归" : "Run FM Regression"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}

      {result && (
        <>
          <p className="text-[11px] text-gray-400">
            {zh
              ? `${result.n_periods} 期月度截面回归，平均每期 ${result.n_symbols_avg.toFixed(0)} 只股票`
              : `${result.n_periods} monthly cross-section regressions, avg ${result.n_symbols_avg.toFixed(0)} symbols/period`}
          </p>
          <div className="overflow-hidden rounded-lg border border-white/10">
            <table className="w-full text-[11px]">
              <thead className="bg-white/5 text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left">
                    {zh ? "因子" : "Factor"}
                  </th>
                  <th className="px-3 py-2 text-right">
                    {zh ? "月均溢价" : "Avg Premium"}
                  </th>
                  <th className="px-3 py-2 text-right">
                    t-{zh ? "值 (NW)" : "stat (NW)"}
                  </th>
                  <th className="px-3 py-2 text-right">
                    p-{zh ? "值" : "value"}
                  </th>
                  <th className="px-3 py-2 text-right">
                    {zh ? "影响系数" : "Impact"}
                  </th>
                  <th className="px-3 py-2 text-center">
                    {zh ? "显著？" : "Sig?"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.factors.map((f) => {
                  const fname = f.factor_name as FactorName;
                  const label = zh
                    ? (FACTOR_LABELS[fname]?.zh ?? f.factor_name)
                    : (FACTOR_LABELS[fname]?.en ?? f.factor_name);
                  return (
                    <tr
                      key={f.factor_name}
                      className={`border-t border-white/5 ${f.is_significant ? "bg-emerald-500/5" : ""}`}
                    >
                      <td className="px-3 py-2 font-medium text-white">
                        {label}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-300">
                        {f.avg_premium >= 0 ? "+" : ""}
                        {f.avg_premium.toFixed(3)}%
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono font-bold ${
                          f.is_significant
                            ? "text-emerald-300"
                            : "text-gray-400"
                        }`}
                      >
                        {f.t_stat.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-400">
                        {f.p_value.toFixed(3)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-300">
                        {f.impact_coefficient >= 0 ? "+" : ""}
                        {f.impact_coefficient.toFixed(3)}%
                      </td>
                      <td className="px-3 py-2 text-center">
                        {f.is_significant ? (
                          <CheckCircle2 className="mx-auto h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <span className="text-gray-700">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="rounded-lg bg-violet-500/5 px-3 py-2 text-[11px] text-violet-300">
            💡 {result.interpretation}
          </p>
          <p className="text-[10px] text-gray-600">
            {zh
              ? "* 显著性阈值 |t| ≥ 2.0（书中第 4.2 节）。Newey-West 调整可处理月度溢价的自相关性。"
              : "* Significance threshold |t| ≥ 2.0 (book Sec 4.2). NW adjusts for autocorrelated monthly premiums."}
          </p>
        </>
      )}
    </div>
  );
}

// ── Tab 4: Long-Short Backtest ─────────────────────────────────────────────

function BacktestPanel({ zh }: { zh: boolean }) {
  const [factor, setFactor] = useState<FactorName>("quality");
  const [longPct, setLongPct] = useState(20);
  const [shortPct, setShortPct] = useState(20);
  const [lookback, setLookback] = useState(24);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    long_avg_return: number;
    short_avg_return: number;
    spread_avg_return: number;
    annualized_return: number;
    annualized_vol: number;
    sharpe_ratio: number;
    max_drawdown: number;
    win_rate: number;
    n_periods: number;
    cumulative_curve: {
      date: string;
      long: number;
      short: number;
      spread: number;
    }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE_URL}/v1/factors/research/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factor_name: factor,
          long_pct: longPct / 100,
          short_pct: shortPct / 100,
          lookback_months: lookback,
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
  }, [factor, longPct, shortPct, lookback]);

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <label className="mb-1 block text-[10px] text-gray-500">
            {zh ? "因子" : "Factor"}
          </label>
          <select
            value={factor}
            onChange={(e) => setFactor(e.target.value as FactorName)}
            className="w-full rounded-md border border-white/10 bg-slate-800 px-2 py-1.5 text-xs text-white"
          >
            {FACTOR_LIST.map((f) => (
              <option key={f} value={f}>
                {zh ? FACTOR_LABELS[f].zh : FACTOR_LABELS[f].en}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-gray-500">
            {zh ? "做多比例 %" : "Long %"}
          </label>
          <input
            type="number"
            value={longPct}
            min={5}
            max={50}
            step={5}
            onChange={(e) => setLongPct(parseInt(e.target.value) || 20)}
            className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-gray-500">
            {zh ? "做空比例 %" : "Short %"}
          </label>
          <input
            type="number"
            value={shortPct}
            min={5}
            max={50}
            step={5}
            onChange={(e) => setShortPct(parseInt(e.target.value) || 20)}
            className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-gray-500">
            {zh ? "回看月数" : "Lookback"}
          </label>
          <input
            type="number"
            value={lookback}
            min={6}
            max={60}
            onChange={(e) => setLookback(parseInt(e.target.value) || 24)}
            className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white"
          />
        </div>
      </div>
      <button
        onClick={run}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-amber-500/20 px-3 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <LineChart className="h-3.5 w-3.5" />
        )}
        {zh ? "运行多空回测" : "Run Long-Short Backtest"}
      </button>

      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}

      {result && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat
              label={zh ? "年化收益" : "Annual Return"}
              value={`${result.annualized_return >= 0 ? "+" : ""}${result.annualized_return.toFixed(1)}%`}
              tone={result.annualized_return >= 0 ? "good" : "bad"}
            />
            <Stat
              label="Sharpe"
              value={result.sharpe_ratio.toFixed(2)}
              tone={
                result.sharpe_ratio >= 1
                  ? "good"
                  : result.sharpe_ratio >= 0
                    ? "neutral"
                    : "bad"
              }
            />
            <Stat
              label={zh ? "最大回撤" : "Max DD"}
              value={`-${result.max_drawdown.toFixed(1)}%`}
              tone="bad"
            />
            <Stat
              label={zh ? "胜率" : "Win Rate"}
              value={`${result.win_rate.toFixed(0)}%`}
              tone={result.win_rate >= 50 ? "good" : "bad"}
            />
          </div>

          {/* Equity curve (SVG) */}
          <CurveChart curve={result.cumulative_curve} zh={zh} />

          <div className="rounded-lg bg-white/5 px-3 py-2 text-[10px] text-gray-400">
            {zh ? "做多收益" : "Long avg"}:{" "}
            <span className="font-mono text-emerald-400">
              +{result.long_avg_return.toFixed(2)}%/m
            </span>
            {" · "}
            {zh ? "做空收益" : "Short avg"}:{" "}
            <span className="font-mono text-red-400">
              {result.short_avg_return >= 0 ? "+" : ""}
              {result.short_avg_return.toFixed(2)}%/m
            </span>
            {" · "}
            {zh ? "周期" : "Periods"}: {result.n_periods}
          </div>
        </>
      )}
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
  const cls =
    tone === "good"
      ? "text-emerald-300 bg-emerald-500/10"
      : tone === "bad"
        ? "text-red-300 bg-red-500/10"
        : "text-gray-300 bg-white/5";
  return (
    <div className={`rounded-lg px-2 py-2 text-center ${cls}`}>
      <p className="text-[10px] opacity-70">{label}</p>
      <p className="font-mono text-base font-bold">{value}</p>
    </div>
  );
}

function CurveChart({
  curve,
  zh,
}: {
  curve: { date: string; long: number; short: number; spread: number }[];
  zh: boolean;
}) {
  if (curve.length < 2) return null;
  const w = 600;
  const h = 200;
  const pad = 30;
  const xs = curve.map(
    (_, i) => pad + (i / (curve.length - 1)) * (w - 2 * pad),
  );

  const allValues = curve.flatMap((c) => [c.long, c.short, c.spread]);
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const yRange = yMax - yMin || 1;
  const y = (v: number) => h - pad - ((v - yMin) / yRange) * (h - 2 * pad);

  const linePath = (key: "long" | "short" | "spread") =>
    curve
      .map(
        (c, i) =>
          `${i === 0 ? "M" : "L"} ${xs[i].toFixed(1)} ${y(c[key]).toFixed(1)}`,
      )
      .join(" ");

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between text-[10px]">
        <p className="font-semibold text-gray-400">
          {zh ? "权益曲线（基期=1.0）" : "Equity Curve (base=1.0)"}
        </p>
        <div className="flex gap-3">
          <span className="text-emerald-400">━ {zh ? "做多" : "Long"}</span>
          <span className="text-red-400">━ {zh ? "做空" : "Short"}</span>
          <span className="text-violet-400">
            ━ {zh ? "多空对冲" : "Spread"}
          </span>
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="text-gray-500">
        {/* Y axis ticks */}
        {[0, 0.5, 1].map((frac) => {
          const yPos = pad + frac * (h - 2 * pad);
          const v = yMax - frac * yRange;
          return (
            <g key={frac}>
              <line
                x1={pad}
                y1={yPos}
                x2={w - pad}
                y2={yPos}
                stroke="rgba(255,255,255,0.05)"
              />
              <text
                x={pad - 4}
                y={yPos + 3}
                textAnchor="end"
                className="fill-gray-600 text-[9px]"
              >
                {v.toFixed(2)}
              </text>
            </g>
          );
        })}
        {/* Baseline = 1.0 */}
        <line
          x1={pad}
          y1={y(1.0)}
          x2={w - pad}
          y2={y(1.0)}
          stroke="rgba(255,255,255,0.15)"
          strokeDasharray="3 3"
        />
        {/* Lines */}
        <path
          d={linePath("long")}
          fill="none"
          stroke="rgb(16,185,129)"
          strokeWidth="1.5"
        />
        <path
          d={linePath("short")}
          fill="none"
          stroke="rgb(239,68,68)"
          strokeWidth="1.5"
        />
        <path
          d={linePath("spread")}
          fill="none"
          stroke="rgb(167,139,250)"
          strokeWidth="2"
        />
        {/* X axis labels (first, mid, last) */}
        {[0, Math.floor(curve.length / 2), curve.length - 1].map((i) => (
          <text
            key={i}
            x={xs[i]}
            y={h - 5}
            textAnchor="middle"
            className="fill-gray-600 text-[9px]"
          >
            {curve[i].date}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

export function FactorResearchPanel() {
  const { locale } = useI18n();
  const zh = locale === "zh";

  const [subTab, setSubTab] = useState<SubTab>("universe");
  const [status, setStatus] = useState<{
    fresh_rows: number;
    total_rows: number;
    default_universe_size: number;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/v1/factors/research/status`);
      if (r.ok) setStatus(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch(`${API_BASE_URL}/v1/factors/research/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await loadStatus();
    } finally {
      setRefreshing(false);
    }
  }, [loadStatus]);

  const subTabs: {
    key: SubTab;
    zh: string;
    en: string;
    icon: React.ElementType;
  }[] = [
    { key: "universe", zh: "因子池", en: "Universe", icon: Database },
    { key: "sort", zh: "横截面排序", en: "Sort", icon: TrendingUp },
    {
      key: "fama_macbeth",
      zh: "Fama-MacBeth",
      en: "Fama-MacBeth",
      icon: Calculator,
    },
    { key: "backtest", zh: "多空回测", en: "Backtest", icon: LineChart },
  ];

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <StatusHeader
        status={status}
        refreshing={refreshing}
        onRefresh={refresh}
        zh={zh}
      />

      {/* Sub-tab nav */}
      <div className="mb-4 inline-flex rounded-lg border border-white/10 bg-black/20 p-1">
        {subTabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                subTab === t.key
                  ? "bg-cyan-500/20 text-cyan-300"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {zh ? t.zh : t.en}
            </button>
          );
        })}
      </div>

      {/* Sub-tab content */}
      {subTab === "universe" && <UniversePanel zh={zh} />}
      {subTab === "sort" && <SortPanel zh={zh} />}
      {subTab === "fama_macbeth" && <FamaMacBethPanel zh={zh} />}
      {subTab === "backtest" && <BacktestPanel zh={zh} />}
    </section>
  );
}
