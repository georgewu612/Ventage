"use client";

import { useState } from "react";
import { AlertCircle, Loader2, Play, Target } from "lucide-react";

import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";

// ── Types ────────────────────────────────────────────────────────────────

interface PatternMeta {
  key: string;
  zh: string;
  direction: "long" | "short";
}

const PATTERNS: PatternMeta[] = [
  { key: "w_bottom", zh: "W 底", direction: "long" },
  { key: "m_top", zh: "M 頭", direction: "short" },
  { key: "failed_breakdown", zh: "破底翻", direction: "long" },
  { key: "failed_breakout", zh: "假突破", direction: "short" },
  {
    key: "w_bottom_with_failed_breakdown",
    zh: "破底翻 W 底",
    direction: "long",
  },
  { key: "head_shoulders_bottom", zh: "頭肩底", direction: "long" },
  { key: "head_shoulders_top", zh: "頭肩頂", direction: "short" },
  { key: "failed_breakout_hs_top", zh: "假突破頭肩頂", direction: "short" },
  { key: "falling_flag", zh: "下傾旗形", direction: "long" },
  { key: "rising_flag", zh: "上攬旗形", direction: "short" },
  {
    key: "converging_triangle_bottom",
    zh: "收斂三角形底部",
    direction: "long",
  },
  { key: "converging_triangle_top", zh: "收斂三角形頂部", direction: "short" },
];

const PATTERN_EN: Record<string, string> = {
  w_bottom: "W-Bottom",
  m_top: "M-Top",
  failed_breakdown: "Failed Breakdown",
  failed_breakout: "Failed Breakout",
  w_bottom_with_failed_breakdown: "W-Bottom + Failed Breakdown",
  head_shoulders_bottom: "Head & Shoulders Bottom",
  head_shoulders_top: "Head & Shoulders Top",
  failed_breakout_hs_top: "H&S Top + Failed Breakout",
  falling_flag: "Falling Flag",
  rising_flag: "Rising Flag",
  converging_triangle_bottom: "Converging Triangle (Bull)",
  converging_triangle_top: "Converging Triangle (Bear)",
};

interface BacktestResult {
  pattern: string;
  pattern_zh: string;
  universe: string;
  n_symbols_tested: number;
  lookback_years: number;
  n_signals: number;
  n_signals_per_year: number;
  win_rate: number;
  target_1_hit_rate: number;
  target_2_hit_rate: number;
  invalidation_rate: number;
  stop_rate: number;
  open_rate: number;
  avg_return_pct: number;
  avg_bars_held: number;
  avg_pattern_quality: number;
  cai_sen_book_claim: {
    win_rate: string;
    avg_return_low: number;
    avg_return_high: number;
  };
  honest_comparison: string;
  min_quality_applied?: number;
  n_signals_pre_filter?: number;
  by_quality?: Array<{
    range: string;
    n: number;
    win_rate?: number;
    avg_return_pct?: number;
    target_1_hit_rate?: number;
    stop_rate?: number;
    avg_bars_held?: number;
  }>;
  quality_alpha?: boolean;
  quality_alpha_note?: string;
  sweet_spot?: {
    range: string;
    n: number;
    win_rate: number;
    avg_return_pct: number;
    stop_rate: number;
  } | null;
  sample_trades: Array<{
    symbol: string;
    signal_date: string;
    entry: number;
    exit: number;
    outcome: string;
    return_pct: number;
    bars_held: number;
    pattern_quality: number;
  }>;
  failures?: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function pctFmt(v: number, decimals = 1): string {
  return `${(v * 100).toFixed(decimals)}%`;
}

function outcomeBadge(outcome: string): { label: string; cls: string } {
  const map: Record<string, { label: string; cls: string }> = {
    target_1: { label: "T1", cls: "bg-emerald-500/20 text-emerald-300" },
    target_2: { label: "T2", cls: "bg-emerald-500/30 text-emerald-200" },
    stop: { label: "Stop", cls: "bg-red-500/20 text-red-300" },
    invalidation: { label: "Invalid", cls: "bg-amber-500/20 text-amber-300" },
    open: { label: "Open", cls: "bg-slate-500/20 text-slate-300" },
  };
  return (
    map[outcome] ?? { label: outcome, cls: "bg-slate-500/20 text-slate-300" }
  );
}

// ── Main panel ───────────────────────────────────────────────────────────

export default function PatternBacktestPanel() {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const [pattern, setPattern] = useState("w_bottom");
  const [universe, setUniverse] = useState("sp500");
  const [years, setYears] = useState(5);
  const [maxSymbols, setMaxSymbols] = useState(50);
  const [minQuality, setMinQuality] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runBacktest() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/patterns/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern,
          universe,
          lookback_years: years,
          max_symbols: maxSymbols,
          min_quality: minQuality,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
      const json: BacktestResult = await res.json();
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
          <Target className="h-5 w-5 text-cyan-400" />
          {isZh ? "形态回测沙盒" : "Pattern Backtest Sandbox"}
        </h3>
        <p className="mb-4 text-sm text-slate-400">
          {isZh
            ? "基于蔡森《多空轉折一手抓》12 个图形 + 等幅满足计算。OOS 验证书中声明的胜率和报酬区间。"
            : "Based on Cai Sen's 12-pattern method with measured-move targets. OOS-validates the book's claimed win rate and return ranges."}
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">
              {isZh ? "形态" : "Pattern"}
            </label>
            <select
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            >
              {PATTERNS.map((p) => (
                <option key={p.key} value={p.key}>
                  {isZh ? p.zh : (PATTERN_EN[p.key] ?? p.key)} (
                  {p.direction === "long" ? "📈" : "📉"})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">
              {isZh ? "标的池" : "Universe"}
            </label>
            <select
              value={universe}
              onChange={(e) => setUniverse(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            >
              <option value="sp500">S&P 500</option>
              <option value="nasdaq100">NASDAQ 100</option>
              <option value="custom">Sample (36 mega-caps)</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">
              {isZh ? "回测窗口" : "Lookback"}
            </label>
            <select
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            >
              <option value={1}>1 {isZh ? "年" : "year"}</option>
              <option value={3}>3 {isZh ? "年" : "years"}</option>
              <option value={5}>5 {isZh ? "年" : "years"}</option>
              <option value={10}>10 {isZh ? "年" : "years"}</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">
              {isZh ? "最大标的数" : "Max symbols"}
            </label>
            <select
              value={maxSymbols}
              onChange={(e) => setMaxSymbols(Number(e.target.value))}
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-2 flex items-center justify-between text-xs text-slate-400">
            <span>
              {isZh ? "最低形态质量分" : "Min Pattern Quality"}{" "}
              <span className="text-slate-500">
                {isZh ? "（过滤掉低质量信号）" : "(filter low-quality signals)"}
              </span>
            </span>
            <span className="font-mono text-cyan-300">≥ {minQuality}</span>
          </label>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={minQuality}
            onChange={(e) => setMinQuality(Number(e.target.value))}
            className="w-full accent-cyan-400"
          />
          <div className="mt-1 flex justify-between text-[10px] text-slate-500">
            <span>0</span>
            <span>50</span>
            <span>65</span>
            <span>80</span>
            <span>90</span>
          </div>
        </div>

        <button
          onClick={runBacktest}
          disabled={running}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-400 disabled:opacity-50"
        >
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {isZh ? "回测中…（30-90 秒）" : "Backtesting… (30-90s)"}
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              {isZh ? "运行回测" : "Run Backtest"}
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertCircle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      )}

      {result && <ResultsDisplay r={result} isZh={isZh} />}
    </div>
  );
}

// ── Results display ──────────────────────────────────────────────────────

function QualityBucketCard({ r, isZh }: { r: BacktestResult; isZh: boolean }) {
  const buckets = r.by_quality ?? [];
  const validBuckets = buckets.filter((b) => b.n >= 5);
  const maxWr = validBuckets.length
    ? Math.max(...validBuckets.map((b) => b.win_rate ?? 0))
    : 0;

  const alphaToneCls = r.quality_alpha
    ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-300"
    : (r.quality_alpha_note ?? "").startsWith("⚠️")
      ? "border-amber-500/40 bg-amber-500/5 text-amber-300"
      : "border-slate-700 bg-slate-800/30 text-slate-400";

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-cyan-400">
        🎯 {isZh ? "质量分桶分析" : "Quality Bucket Analysis"}
      </h4>

      <div className={`mb-4 rounded border p-3 text-sm ${alphaToneCls}`}>
        {r.quality_alpha_note ?? "—"}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-slate-700 text-slate-400">
            <tr>
              <th className="px-2 py-1 text-left">
                {isZh ? "质量分区间" : "Quality Range"}
              </th>
              <th className="px-2 py-1 text-right">N</th>
              <th className="px-2 py-1 text-right">
                {isZh ? "胜率" : "Win Rate"}
              </th>
              <th className="px-2 py-1 text-right">
                {isZh ? "平均报酬" : "Avg Return"}
              </th>
              <th className="px-2 py-1 text-right">T1 hit</th>
              <th className="px-2 py-1 text-right">
                {isZh ? "止损率" : "Stop Rate"}
              </th>
              <th className="px-2 py-1 text-right">{isZh ? "持仓" : "Hold"}</th>
              <th className="px-2 py-1 text-left">
                {isZh ? "胜率分布" : "WR Bar"}
              </th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => {
              if (b.n === 0) {
                return (
                  <tr key={b.range} className="border-b border-slate-800">
                    <td className="px-2 py-1 font-mono text-slate-500">
                      {b.range}
                    </td>
                    <td
                      className="px-2 py-1 text-center text-slate-500"
                      colSpan={7}
                    >
                      {isZh ? "无样本" : "no samples"}
                    </td>
                  </tr>
                );
              }
              const wr = b.win_rate ?? 0;
              const isMax = wr === maxWr && b.n >= 5;
              const wrCls =
                wr >= 0.6
                  ? "text-emerald-300"
                  : wr >= 0.5
                    ? "text-cyan-300"
                    : wr >= 0.4
                      ? "text-slate-300"
                      : "text-red-300";
              const barWidth = `${wr * 100}%`;
              const barCls =
                wr >= 0.6
                  ? "bg-emerald-500"
                  : wr >= 0.5
                    ? "bg-cyan-500"
                    : wr >= 0.4
                      ? "bg-slate-500"
                      : "bg-red-500";
              const ret = b.avg_return_pct ?? 0;
              return (
                <tr
                  key={b.range}
                  className={`border-b border-slate-800 ${isMax ? "bg-emerald-500/5" : ""}`}
                >
                  <td className="px-2 py-1 font-mono text-cyan-300">
                    {b.range}
                    {isMax && (
                      <span className="ml-2 rounded bg-emerald-500/20 px-1 py-0.5 text-[9px] font-semibold text-emerald-300">
                        {isZh ? "最佳" : "BEST"}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right text-slate-300">{b.n}</td>
                  <td className={`px-2 py-1 text-right font-mono ${wrCls}`}>
                    {(wr * 100).toFixed(1)}%
                  </td>
                  <td
                    className={`px-2 py-1 text-right font-mono ${ret >= 0 ? "text-emerald-300" : "text-red-300"}`}
                  >
                    {ret >= 0 ? "+" : ""}
                    {ret.toFixed(2)}%
                  </td>
                  <td className="px-2 py-1 text-right text-slate-300">
                    {((b.target_1_hit_rate ?? 0) * 100).toFixed(0)}%
                  </td>
                  <td className="px-2 py-1 text-right text-red-300">
                    {((b.stop_rate ?? 0) * 100).toFixed(0)}%
                  </td>
                  <td className="px-2 py-1 text-right text-slate-300">
                    {(b.avg_bars_held ?? 0).toFixed(0)}
                  </td>
                  <td className="px-2 py-1">
                    <div className="h-2 w-32 rounded bg-slate-800">
                      <div
                        className={`h-2 rounded ${barCls}`}
                        style={{ width: barWidth }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {r.sweet_spot && (
        <div className="mt-3 rounded border border-cyan-500/30 bg-cyan-500/5 p-3 text-xs text-cyan-200">
          {isZh ? "🎯 最佳质量区间：" : "🎯 Sweet spot: "}
          <span className="font-mono">{r.sweet_spot.range}</span>
          {" — "}
          {isZh ? "胜率 " : "WR "}
          <span className="font-semibold">
            {(r.sweet_spot.win_rate * 100).toFixed(1)}%
          </span>
          {", "}
          {isZh ? "平均报酬 " : "avg return "}
          <span className="font-semibold">
            {r.sweet_spot.avg_return_pct >= 0 ? "+" : ""}
            {r.sweet_spot.avg_return_pct.toFixed(2)}%
          </span>
          {", "}
          {isZh ? "止损率 " : "stop "}
          <span className="font-semibold">
            {(r.sweet_spot.stop_rate * 100).toFixed(0)}%
          </span>
          {" (N="}
          {r.sweet_spot.n}
          {")"}
        </div>
      )}
    </div>
  );
}

function ResultsDisplay({ r, isZh }: { r: BacktestResult; isZh: boolean }) {
  if (r.n_signals === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 text-slate-400">
        {isZh
          ? r.n_signals_pre_filter && r.n_signals_pre_filter > 0
            ? `质量过滤 (≥${r.min_quality_applied}) 后无样本。原始 ${r.n_signals_pre_filter} 个信号被过滤掉。`
            : "未生成任何信号。请尝试更宽松的形态或更长的回测窗口。"
          : "No signals generated."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h4 className="mb-4 text-sm font-semibold text-cyan-400">
          {isZh ? "整体绩效" : "Overall Performance"}
        </h4>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat
            label={isZh ? "信号数" : "Signals"}
            value={String(r.n_signals)}
            sub={`${r.n_signals_per_year}/yr`}
          />
          <Stat
            label={isZh ? "胜率" : "Win Rate"}
            value={pctFmt(r.win_rate)}
            tone={
              r.win_rate >= 0.55
                ? "good"
                : r.win_rate >= 0.45
                  ? "neutral"
                  : "bad"
            }
          />
          <Stat
            label={isZh ? "平均报酬" : "Avg Return"}
            value={`${r.avg_return_pct >= 0 ? "+" : ""}${r.avg_return_pct.toFixed(2)}%`}
            tone={
              r.avg_return_pct > 5
                ? "good"
                : r.avg_return_pct > 0
                  ? "neutral"
                  : "bad"
            }
          />
          <Stat
            label={isZh ? "平均持仓" : "Avg Hold"}
            value={`${r.avg_bars_held.toFixed(0)} ${isZh ? "天" : "bars"}`}
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h4 className="mb-4 text-sm font-semibold text-cyan-400">
          {isZh ? "出场分布" : "Exit Distribution"}
        </h4>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat
            label={isZh ? "T1 达成" : "Target 1 Hit"}
            value={pctFmt(r.target_1_hit_rate)}
            tone="good"
          />
          <Stat
            label={isZh ? "T2 达成" : "Target 2 Hit"}
            value={pctFmt(r.target_2_hit_rate)}
            tone="good"
          />
          <Stat
            label={isZh ? "止损" : "Stop"}
            value={pctFmt(r.stop_rate)}
            tone="bad"
          />
          <Stat
            label={isZh ? "失效" : "Invalidation"}
            value={pctFmt(r.invalidation_rate)}
            tone="bad"
          />
          <Stat label={isZh ? "未结" : "Open"} value={pctFmt(r.open_rate)} />
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-300">
          ⚖️ {isZh ? "蔡森书声明 vs OOS 实测" : "Cai Sen Book Claim vs OOS"}
        </h4>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded border border-slate-700 bg-slate-800/40 p-3">
            <div className="mb-1 text-xs text-slate-400">
              {isZh ? "书中声明" : "Book Claim"}
            </div>
            <div className="text-sm text-slate-300">
              {isZh ? "胜率：" : "Win Rate: "}
              <span className="font-mono text-emerald-300">
                {r.cai_sen_book_claim.win_rate}
              </span>
            </div>
            <div className="text-sm text-slate-300">
              {isZh ? "报酬区间：" : "Return Range: "}
              <span className="font-mono text-emerald-300">
                {pctFmt(r.cai_sen_book_claim.avg_return_low, 0)} -{" "}
                {pctFmt(r.cai_sen_book_claim.avg_return_high, 0)}
              </span>
            </div>
          </div>
          <div className="rounded border border-slate-700 bg-slate-800/40 p-3">
            <div className="mb-1 text-xs text-slate-400">
              {isZh ? "OOS 实测" : "OOS Result"}
            </div>
            <div className="text-sm text-slate-300">
              {isZh ? "胜率：" : "Win Rate: "}
              <span className="font-mono text-cyan-300">
                {pctFmt(r.win_rate)}
              </span>
            </div>
            <div className="text-sm text-slate-300">
              {isZh ? "平均报酬：" : "Avg Return: "}
              <span className="font-mono text-cyan-300">
                {r.avg_return_pct.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
        <p className="mt-3 text-sm text-amber-200">{r.honest_comparison}</p>
      </div>

      {r.by_quality && r.by_quality.length > 0 && (
        <QualityBucketCard r={r} isZh={isZh} />
      )}

      {r.sample_trades.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h4 className="mb-3 text-sm font-semibold text-cyan-400">
            {isZh
              ? `样本交易 (前 ${Math.min(r.sample_trades.length, 30)} 笔)`
              : `Sample Trades (top ${Math.min(r.sample_trades.length, 30)})`}
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-700 text-slate-400">
                <tr>
                  <th className="px-2 py-1 text-left">Symbol</th>
                  <th className="px-2 py-1 text-left">
                    {isZh ? "信号日期" : "Date"}
                  </th>
                  <th className="px-2 py-1 text-right">
                    {isZh ? "入场" : "Entry"}
                  </th>
                  <th className="px-2 py-1 text-right">
                    {isZh ? "出场" : "Exit"}
                  </th>
                  <th className="px-2 py-1 text-right">Return</th>
                  <th className="px-2 py-1 text-right">
                    {isZh ? "持仓" : "Bars"}
                  </th>
                  <th className="px-2 py-1 text-right">Quality</th>
                  <th className="px-2 py-1 text-center">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {r.sample_trades.slice(0, 30).map((t, i) => {
                  const ob = outcomeBadge(t.outcome);
                  return (
                    <tr
                      key={i}
                      className="border-b border-slate-800 text-slate-300"
                    >
                      <td className="px-2 py-1 font-mono text-cyan-300">
                        {t.symbol}
                      </td>
                      <td className="px-2 py-1">
                        {t.signal_date.slice(0, 10)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        ${t.entry.toFixed(2)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        ${t.exit.toFixed(2)}
                      </td>
                      <td
                        className={`px-2 py-1 text-right font-mono ${t.return_pct >= 0 ? "text-emerald-300" : "text-red-300"}`}
                      >
                        {t.return_pct >= 0 ? "+" : ""}
                        {(t.return_pct * 100).toFixed(2)}%
                      </td>
                      <td className="px-2 py-1 text-right">{t.bars_held}</td>
                      <td className="px-2 py-1 text-right">
                        {t.pattern_quality.toFixed(0)}
                      </td>
                      <td className="px-2 py-1 text-center">
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-semibold ${ob.cls}`}
                        >
                          {ob.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "neutral";
}) {
  const cls =
    tone === "good"
      ? "text-emerald-300"
      : tone === "bad"
        ? "text-red-300"
        : "text-white";
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-lg font-semibold ${cls}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
