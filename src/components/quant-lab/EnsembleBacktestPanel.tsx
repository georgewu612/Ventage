"use client";

/**
 * Ensemble Backtest — combine multiple PIT-validated strategies into a
 * portfolio. Per AQR's Style Premia approach: equal-weight diversification
 * across uncorrelated alpha sources, no factor timing.
 *
 * Workflow:
 *   1. Pick 2-4 strategies from preset list (or modify conditions)
 *   2. Backend runs PIT backtest for each + computes correlation matrix
 *   3. Equal-weight ensemble = mean of strategy returns each period
 *   4. UI shows: comparison table + correlation heatmap + 4 equity curves
 */

import { useState, useCallback } from "react";
import { Layers, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";

// ── Types ───────────────────────────────────────────────────────────────────

interface Condition {
  factor: string;
  op: string;
  value: number;
}

interface StrategyDef {
  name: string;
  conditions: Condition[];
}

interface PerStrategyResult {
  name: string;
  n_periods: number;
  annualized_return_pct: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  win_rate_pct: number;
  alpha_annual_pct: number;
  information_ratio: number;
  avg_holdings: number;
}

interface EnsembleResult {
  n_strategies: number;
  strategy_names: string[];
  n_common_periods: number;
  common_dates: string[];
  per_strategy: PerStrategyResult[];
  correlation_matrix: Record<string, Record<string, number>>;
  avg_pairwise_correlation: number;
  ensemble: {
    annualized_return_pct: number;
    annualized_vol_pct: number;
    sharpe_ratio: number;
    max_drawdown_pct: number;
    win_rate_pct: number;
    alpha_annual_pct: number;
    information_ratio: number;
  };
  best_single_sharpe: number;
  sharpe_uplift: number;
  diversification_grade: "excellent" | "good" | "marginal" | "redundant";
  interpretation: string;
  cumulative_curves: Record<string, { date: string; value: number }[]>;
  warnings: string[];
}

// ── 4 Presets (mirror StockScreenerPanel) ──────────────────────────────────

const PRESETS: StrategyDef[] = [
  {
    name: "Triple Confirmation",
    conditions: [
      { factor: "new_high_52w", op: ">=", value: 0.85 },
      { factor: "rs_vs_spy", op: ">=", value: 0.05 },
      { factor: "momentum_60d", op: ">=", value: 0.1 },
    ],
  },
  {
    name: "Pure Momentum",
    conditions: [
      { factor: "momentum", op: ">=", value: 0.3 },
      { factor: "new_high_52w", op: ">=", value: 0.9 },
      { factor: "market_cap", op: ">=", value: 20_000_000_000 },
    ],
  },
  {
    name: "Quality + Trend",
    conditions: [
      { factor: "quality", op: ">=", value: 0.2 },
      { factor: "new_high_52w", op: ">=", value: 0.7 },
      { factor: "rs_vs_spy", op: ">=", value: 0 },
    ],
  },
  {
    name: "Avoid Tops",
    conditions: [
      { factor: "new_high_52w", op: ">=", value: 0.85 },
      { factor: "rs_vs_spy", op: ">=", value: 0.03 },
      { factor: "volume_spike_5d", op: "<=", value: 1.3 },
    ],
  },
  // ── 3 ORTHOGONAL strategies (designed to LOW-correlate with momentum) ──
  {
    // Mean reversion: stocks that fell hard but aren't garbage
    name: "Short-Term Reversal",
    conditions: [
      { factor: "momentum_60d", op: "<=", value: -0.05 },
      { factor: "new_high_52w", op: "<=", value: 0.4 },
      { factor: "rs_vs_spy", op: "<=", value: 0 },
    ],
  },
  {
    // Defensive: low vol, mid-range, no momentum spike — stable boring stocks
    name: "True Defensive",
    conditions: [
      { factor: "low_vol", op: ">=", value: -0.25 },
      { factor: "new_high_52w", op: ">=", value: 0.4 },
      { factor: "new_high_52w", op: "<=", value: 0.7 },
      { factor: "volume_trend_20d", op: "<=", value: 0 },
    ],
  },
  {
    // Early breakout: just broke out but momentum hasn't yet caught up
    name: "Early Breakout",
    conditions: [
      { factor: "breakout_20d", op: ">=", value: 0 },
      { factor: "new_high_52w", op: "<=", value: 0.8 },
      { factor: "volume_spike_5d", op: ">=", value: 1.2 },
    ],
  },
];

const PRESET_LABELS: Record<string, { zh: string; en: string }> = {
  "Triple Confirmation": { zh: "⭐ 三重确认", en: "⭐ Triple Confirmation" },
  "Pure Momentum": { zh: "🚀 纯动量", en: "🚀 Pure Momentum" },
  "Quality + Trend": { zh: "🛡️ 质量+趋势", en: "🛡️ Quality + Trend" },
  "Avoid Tops": { zh: "🎯 避免顶部", en: "🎯 Avoid Tops" },
  "Short-Term Reversal": { zh: "🔄 短期反转", en: "🔄 Short-Term Reversal" },
  "True Defensive": { zh: "🛡️ 真正防守", en: "🛡️ True Defensive" },
  "Early Breakout": { zh: "📈 早期突破", en: "📈 Early Breakout" },
};

// Strategy line colors (7 distinct hues for our 7 presets)
const STRATEGY_COLORS = [
  "rgb(34, 211, 238)", // cyan
  "rgb(167, 139, 250)", // violet
  "rgb(251, 191, 36)", // amber
  "rgb(248, 113, 113)", // red
  "rgb(94, 234, 212)", // teal
  "rgb(244, 114, 182)", // pink
  "rgb(132, 204, 22)", // lime
];
const ENSEMBLE_COLOR = "rgb(52, 211, 153)"; // emerald
const BENCHMARK_COLOR = "rgb(107, 114, 128)"; // gray

// ── Helpers ──────────────────────────────────────────────────────────────

const tone = (
  v: number,
  cmp: ">0" | "abs>1" | "abs>0.5",
): "good" | "bad" | "neutral" => {
  if (cmp === ">0") return v > 0 ? "good" : v < 0 ? "bad" : "neutral";
  if (cmp === "abs>1") return Math.abs(v) > 1 ? "good" : "neutral";
  return Math.abs(v) > 0.5 ? "good" : "neutral";
};

const TONE_CLS: Record<"good" | "bad" | "neutral", string> = {
  good: "text-emerald-300 bg-emerald-500/10",
  bad: "text-red-300 bg-red-500/10",
  neutral: "text-gray-300 bg-white/5",
};

// Diversification badge styles
const GRADE_STYLES: Record<
  EnsembleResult["diversification_grade"],
  { color: string; label_zh: string; label_en: string }
> = {
  excellent: {
    color: "text-emerald-300 bg-emerald-500/15 border-emerald-500/40",
    label_zh: "极佳",
    label_en: "Excellent",
  },
  good: {
    color: "text-cyan-300 bg-cyan-500/15 border-cyan-500/40",
    label_zh: "良好",
    label_en: "Good",
  },
  marginal: {
    color: "text-amber-300 bg-amber-500/15 border-amber-500/40",
    label_zh: "一般",
    label_en: "Marginal",
  },
  redundant: {
    color: "text-red-300 bg-red-500/15 border-red-500/40",
    label_zh: "冗余",
    label_en: "Redundant",
  },
};

// ── Main ─────────────────────────────────────────────────────────────────

export function EnsembleBacktestPanel() {
  const { locale } = useI18n();
  const zh = locale === "zh";

  // Selected presets (default: all 4)
  const [selected, setSelected] = useState<Set<string>>(
    new Set(PRESETS.map((p) => p.name)),
  );
  const [data, setData] = useState<EnsembleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  };

  const run = useCallback(async () => {
    if (selected.size < 2) {
      setError(zh ? "至少选择 2 个策略" : "Select ≥2 strategies");
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const strategies = PRESETS.filter((p) => selected.has(p.name));
      const r = await fetch(
        `${API_BASE_URL}/v1/factors/screener/backtest/ensemble`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategies,
            benchmark: "SPY",
            min_holdings: 5,
          }),
        },
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${r.status}`);
      }
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selected, zh]);

  return (
    <div className="space-y-3">
      {/* Strategy selector */}
      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-violet-300">
          <Layers className="h-3 w-3" />
          {zh
            ? "选择策略组合（推荐 3-4 个）"
            : "Select Strategies (recommend 3-4)"}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PRESETS.map((p) => {
            const checked = selected.has(p.name);
            const labels = PRESET_LABELS[p.name];
            return (
              <button
                key={p.name}
                onClick={() => toggle(p.name)}
                className={`rounded-md border p-2.5 text-left transition-all ${
                  checked
                    ? "border-violet-500/50 bg-violet-500/10 ring-1 ring-violet-500/30"
                    : "border-white/10 bg-white/5 hover:border-white/20"
                }`}
              >
                <div className="flex items-start gap-1.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {}}
                    className="mt-0.5 accent-violet-500"
                  />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-white">
                      {zh ? labels.zh : labels.en}
                    </p>
                    <p className="mt-0.5 text-[10px] text-gray-400">
                      {p.conditions.length} {zh ? "条件" : "conditions"}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <button
        onClick={run}
        disabled={loading || selected.size < 2}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-amber-500/20 px-3 py-2.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {zh
              ? `运行 ${selected.size} 个策略 + 等权组合 PIT 回测...`
              : `Running ${selected.size} strategies + ensemble PIT backtest...`}
          </>
        ) : (
          <>
            <Layers className="h-3.5 w-3.5" />
            {zh
              ? `运行 ${selected.size} 个策略 + 等权组合`
              : `Run ${selected.size} strategies + Ensemble`}
          </>
        )}
      </button>

      {error && (
        <div className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {data && <EnsembleResults data={data} zh={zh} />}
    </div>
  );
}

// ── Results ──────────────────────────────────────────────────────────────

function EnsembleResults({ data, zh }: { data: EnsembleResult; zh: boolean }) {
  const grade = GRADE_STYLES[data.diversification_grade];
  const upliftGood = data.sharpe_uplift > 0.1;

  return (
    <>
      {/* Headline banner */}
      <div className={`rounded-lg border-2 px-4 py-3 ${grade.color}`}>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-bold">
            {upliftGood ? "✅" : data.sharpe_uplift > 0 ? "⚠️" : "🔴"}{" "}
            {zh ? "组合策略回测" : "Ensemble Backtest"}
          </p>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${grade.color}`}
          >
            {zh ? "多元化" : "Diversification"}:{" "}
            {zh ? grade.label_zh : grade.label_en}
          </span>
        </div>
        <p className="text-[11px] opacity-90">{data.interpretation}</p>
        <p className="mt-1 text-[10px] opacity-70">
          {zh ? "共同期" : "Common periods"}: {data.n_common_periods}{" "}
          {zh ? "月" : "mo"} · {zh ? "平均相关性" : "avg correlation"}:{" "}
          {data.avg_pairwise_correlation.toFixed(2)}
        </p>
      </div>

      {/* Ensemble metrics */}
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
        <p className="mb-2 text-[11px] font-semibold text-emerald-300">
          🎯 {zh ? "等权组合（PIT 真实）" : "Equal-Weight Ensemble (true PIT)"}
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Stat
            label={zh ? "年化收益" : "Annual Ret"}
            value={`${data.ensemble.annualized_return_pct >= 0 ? "+" : ""}${data.ensemble.annualized_return_pct.toFixed(1)}%`}
            tone={tone(data.ensemble.annualized_return_pct, ">0")}
          />
          <Stat
            label="Sharpe"
            value={data.ensemble.sharpe_ratio.toFixed(2)}
            tone={tone(data.ensemble.sharpe_ratio, "abs>1")}
          />
          <Stat
            label={zh ? "最大回撤" : "Max DD"}
            value={`-${data.ensemble.max_drawdown_pct.toFixed(1)}%`}
            tone={data.ensemble.max_drawdown_pct < 15 ? "good" : "neutral"}
          />
          <Stat
            label={zh ? "胜率" : "Win"}
            value={`${data.ensemble.win_rate_pct.toFixed(0)}%`}
            tone={data.ensemble.win_rate_pct >= 55 ? "good" : "neutral"}
          />
          <Stat
            label="α vs SPY"
            value={`${data.ensemble.alpha_annual_pct >= 0 ? "+" : ""}${data.ensemble.alpha_annual_pct.toFixed(1)}%`}
            tone={tone(data.ensemble.alpha_annual_pct, ">0")}
          />
          <Stat
            label="IR"
            value={data.ensemble.information_ratio.toFixed(2)}
            tone={tone(data.ensemble.information_ratio, "abs>0.5")}
          />
        </div>
        <div className="mt-2 flex items-center justify-between rounded bg-white/5 px-2 py-1 text-[10px]">
          <span className="text-gray-400">
            {zh ? "vs 最强单策略 Sharpe" : "vs Best Single Sharpe"}:{" "}
            <span className="font-mono text-white">
              {data.best_single_sharpe.toFixed(2)}
            </span>
          </span>
          <span
            className={`font-mono font-semibold ${
              data.sharpe_uplift > 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {zh ? "提升" : "Uplift"}: {data.sharpe_uplift >= 0 ? "+" : ""}
            {data.sharpe_uplift.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Per-strategy comparison table */}
      <div className="overflow-hidden rounded-lg border border-white/10">
        <table className="w-full text-[11px]">
          <thead className="bg-white/5 text-gray-400">
            <tr>
              <th className="px-2 py-2 text-left">
                {zh ? "策略" : "Strategy"}
              </th>
              <th className="px-2 py-2 text-right">{zh ? "年化" : "Annual"}</th>
              <th className="px-2 py-2 text-right">Sharpe</th>
              <th className="px-2 py-2 text-right">DD</th>
              <th className="px-2 py-2 text-right">α</th>
              <th className="px-2 py-2 text-right">IR</th>
              <th className="px-2 py-2 text-right">{zh ? "持仓" : "Hold"}</th>
            </tr>
          </thead>
          <tbody>
            {data.per_strategy.map((s, i) => {
              const labels = PRESET_LABELS[s.name];
              return (
                <tr key={s.name} className="border-t border-white/5">
                  <td className="px-2 py-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: STRATEGY_COLORS[i] }}
                    />
                    <span className="ml-1.5 text-white">
                      {labels ? (zh ? labels.zh : labels.en) : s.name}
                    </span>
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-mono ${
                      s.annualized_return_pct >= 0
                        ? "text-emerald-300"
                        : "text-red-300"
                    }`}
                  >
                    {s.annualized_return_pct >= 0 ? "+" : ""}
                    {s.annualized_return_pct.toFixed(1)}%
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-cyan-300">
                    {s.sharpe_ratio.toFixed(2)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-gray-400">
                    -{s.max_drawdown_pct.toFixed(1)}%
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-mono ${
                      s.alpha_annual_pct >= 0
                        ? "text-emerald-300"
                        : "text-red-300"
                    }`}
                  >
                    {s.alpha_annual_pct >= 0 ? "+" : ""}
                    {s.alpha_annual_pct.toFixed(1)}%
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-violet-300">
                    {s.information_ratio.toFixed(2)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-gray-400">
                    {s.avg_holdings.toFixed(0)}
                  </td>
                </tr>
              );
            })}
            {/* Ensemble row highlighted */}
            <tr className="border-t-2 border-emerald-500/30 bg-emerald-500/5">
              <td className="px-2 py-1.5 font-semibold">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: ENSEMBLE_COLOR }}
                />
                <span className="ml-1.5 text-emerald-300">
                  {zh ? "等权组合" : "Ensemble"}
                </span>
              </td>
              <td
                className={`px-2 py-1.5 text-right font-mono font-bold ${
                  data.ensemble.annualized_return_pct >= 0
                    ? "text-emerald-300"
                    : "text-red-300"
                }`}
              >
                {data.ensemble.annualized_return_pct >= 0 ? "+" : ""}
                {data.ensemble.annualized_return_pct.toFixed(1)}%
              </td>
              <td className="px-2 py-1.5 text-right font-mono font-bold text-cyan-300">
                {data.ensemble.sharpe_ratio.toFixed(2)}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-gray-400">
                -{data.ensemble.max_drawdown_pct.toFixed(1)}%
              </td>
              <td
                className={`px-2 py-1.5 text-right font-mono font-bold ${
                  data.ensemble.alpha_annual_pct >= 0
                    ? "text-emerald-300"
                    : "text-red-300"
                }`}
              >
                {data.ensemble.alpha_annual_pct >= 0 ? "+" : ""}
                {data.ensemble.alpha_annual_pct.toFixed(1)}%
              </td>
              <td className="px-2 py-1.5 text-right font-mono font-bold text-violet-300">
                {data.ensemble.information_ratio.toFixed(2)}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-gray-500">
                —
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Equity curves */}
      <EquityCurves data={data} zh={zh} />

      {/* Correlation heatmap */}
      <CorrelationHeatmap data={data} zh={zh} />

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <div className="space-y-1">
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
    </>
  );
}

// ── Equity curves ────────────────────────────────────────────────────────

function EquityCurves({ data, zh }: { data: EnsembleResult; zh: boolean }) {
  const w = 700;
  const h = 220;
  const pad = 36;
  const dateY = h - 6;
  const chartTop = pad - 12;
  const chartBottom = h - pad - 18;

  const dates = data.common_dates;
  if (dates.length < 2) return null;

  const xs = dates.map(
    (_, i) => pad + (i / (dates.length - 1)) * (w - 2 * pad),
  );

  // Combine all series for y-range
  const allValues: number[] = [];
  Object.values(data.cumulative_curves).forEach((curve) => {
    curve.forEach((p) => allValues.push(p.value));
  });
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const yRange = yMax - yMin || 1;
  const y = (v: number) =>
    chartBottom - ((v - yMin) / yRange) * (chartBottom - chartTop);

  const buildPath = (curve: { date: string; value: number }[]) =>
    curve
      .map((p, i) => {
        const x = xs[i];
        return `${i === 0 ? "M" : "L"} ${x?.toFixed(1) ?? 0} ${y(p.value).toFixed(1)}`;
      })
      .join(" ");

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <p className="mb-2 text-[11px] font-semibold text-gray-400">
        {zh ? "权益曲线对比" : "Equity Curves"}
      </p>
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
        {/* Per-strategy */}
        {data.strategy_names.map((name, i) => (
          <path
            key={name}
            d={buildPath(data.cumulative_curves[name] ?? [])}
            fill="none"
            stroke={STRATEGY_COLORS[i % STRATEGY_COLORS.length]}
            strokeWidth="1.2"
            opacity="0.5"
          />
        ))}
        {/* Benchmark */}
        <path
          d={buildPath(data.cumulative_curves["benchmark"] ?? [])}
          fill="none"
          stroke={BENCHMARK_COLOR}
          strokeWidth="1.5"
          strokeDasharray="4 2"
        />
        {/* Ensemble (thick, highlighted) */}
        <path
          d={buildPath(data.cumulative_curves["ensemble"] ?? [])}
          fill="none"
          stroke={ENSEMBLE_COLOR}
          strokeWidth="2.5"
        />

        {/* Y labels */}
        <text
          x={pad - 4}
          y={chartTop + 4}
          textAnchor="end"
          className="fill-gray-600 text-[9px]"
        >
          {yMax.toFixed(2)}
        </text>
        <text
          x={pad - 4}
          y={chartBottom + 4}
          textAnchor="end"
          className="fill-gray-600 text-[9px]"
        >
          {yMin.toFixed(2)}
        </text>

        {/* Date labels */}
        <text
          x={xs[0]}
          y={dateY}
          textAnchor="start"
          className="fill-gray-600 text-[9px]"
        >
          {dates[0]}
        </text>
        {dates.length >= 5 && (
          <text
            x={xs[Math.floor(dates.length / 2)]}
            y={dateY}
            textAnchor="middle"
            className="fill-gray-600 text-[9px]"
          >
            {dates[Math.floor(dates.length / 2)]}
          </text>
        )}
        <text
          x={xs[dates.length - 1]}
          y={dateY}
          textAnchor="end"
          className="fill-gray-600 text-[9px]"
        >
          {dates[dates.length - 1]}
        </text>
      </svg>
      {/* Legend */}
      <div className="mt-1 flex flex-wrap gap-3 text-[10px]">
        {data.strategy_names.map((name, i) => {
          const labels = PRESET_LABELS[name];
          return (
            <span
              key={name}
              className="flex items-center gap-1"
              style={{ color: STRATEGY_COLORS[i % STRATEGY_COLORS.length] }}
            >
              <span
                className="h-2 w-3"
                style={{
                  backgroundColor: STRATEGY_COLORS[i % STRATEGY_COLORS.length],
                }}
              />
              {labels ? (zh ? labels.zh : labels.en) : name}
            </span>
          );
        })}
        <span
          className="flex items-center gap-1 font-bold"
          style={{ color: ENSEMBLE_COLOR }}
        >
          <span
            className="h-2 w-3"
            style={{ backgroundColor: ENSEMBLE_COLOR }}
          />
          {zh ? "等权组合" : "Ensemble"}
        </span>
        <span className="flex items-center gap-1 text-gray-500">
          <span
            className="h-[2px] w-3 border-t-2 border-dashed"
            style={{ borderColor: BENCHMARK_COLOR }}
          />
          SPY
        </span>
      </div>
    </div>
  );
}

// ── Correlation heatmap ──────────────────────────────────────────────────

function CorrelationHeatmap({
  data,
  zh,
}: {
  data: EnsembleResult;
  zh: boolean;
}) {
  const names = data.strategy_names;
  const cellSize = 80;

  // Color: 0 → emerald, 0.5 → amber, 1.0 → red
  const cellBg = (rho: number) => {
    if (rho >= 0.99) return "bg-violet-500/20"; // diagonal
    const abs = Math.abs(rho);
    if (abs > 0.7) return "bg-red-500/30";
    if (abs > 0.5) return "bg-amber-500/25";
    if (abs > 0.3) return "bg-cyan-500/20";
    return "bg-emerald-500/15";
  };

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <p className="mb-2 text-[11px] font-semibold text-gray-400">
        {zh ? "策略相关性矩阵" : "Strategy Correlation Matrix"} —{" "}
        <span className="text-violet-300">
          {zh ? "越低越好（多元化）" : "lower is better (diversification)"}
        </span>
      </p>
      <div className="overflow-x-auto">
        <table className="text-[10px]">
          <thead>
            <tr>
              <th className="px-2"></th>
              {names.map((n) => {
                const labels = PRESET_LABELS[n];
                return (
                  <th
                    key={n}
                    className="px-2 py-1.5 text-center text-[9px] font-medium text-gray-400"
                    style={{ minWidth: cellSize }}
                  >
                    {labels ? (zh ? labels.zh : labels.en) : n}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {names.map((row) => {
              const rowLabels = PRESET_LABELS[row];
              return (
                <tr key={row}>
                  <td className="py-1.5 pr-2 text-right text-[9px] font-medium text-gray-400">
                    {rowLabels ? (zh ? rowLabels.zh : rowLabels.en) : row}
                  </td>
                  {names.map((col) => {
                    const rho = data.correlation_matrix[row]?.[col] ?? 0;
                    return (
                      <td
                        key={col}
                        className={`py-1.5 text-center font-mono font-bold text-white ${cellBg(rho)}`}
                        style={{ minWidth: cellSize }}
                      >
                        {rho.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10px]">
        <span className="text-emerald-300">
          ● {zh ? "<0.3 极佳" : "<0.3 excellent"}
        </span>
        <span className="text-cyan-300">
          ● {zh ? "0.3-0.5 良好" : "0.3-0.5 good"}
        </span>
        <span className="text-amber-300">
          ● {zh ? "0.5-0.7 一般" : "0.5-0.7 marginal"}
        </span>
        <span className="text-red-300">
          ● {zh ? ">0.7 冗余" : ">0.7 redundant"}
        </span>
      </div>
    </div>
  );
}

// ── Stat helper ──────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "bad" | "neutral";
}) {
  return (
    <div className={`rounded-md px-2 py-1.5 text-center ${TONE_CLS[tone]}`}>
      <p className="text-[9px] opacity-70">{label}</p>
      <p className="font-mono text-sm font-bold">{value}</p>
    </div>
  );
}
