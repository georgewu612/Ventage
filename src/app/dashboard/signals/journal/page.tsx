"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import Link from "next/link";

import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";

// ── Types ──────────────────────────────────────────────────────────────────

interface JournalSignal {
  id: string;
  symbol: string;
  strategy_name: string;
  direction: "long" | "short";
  regime_at_signal: string;
  score_grade: "A" | "B" | "C";
  score_total: number;
  entry_price: number;
  stop_price: number;
  target_1: number | null;
  target_2: number | null;
  status: "active" | "closed" | "expired" | "invalidated" | "triggered";
  datetime: string;
  outcome?: {
    pnl_r: number | null;
    pnl_pct: number | null;
    exit_reason: string | null;
    exit_datetime: string | null;
    bars_held: number | null;
    mfe: number | null;
    mae: number | null;
  } | null;
}

interface HistoryResp {
  count: number;
  signals: JournalSignal[];
}

interface StatsResp {
  total: number;
  closed: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_r: number;
  avg_winner_r: number;
  avg_loser_r: number;
  best_r: number;
  worst_r: number;
  by_grade: Record<
    string,
    {
      count: number;
      wins: number;
      losses: number;
      win_rate: number;
      avg_r: number;
      avg_winner_r: number;
      avg_loser_r: number;
    }
  >;
  by_strategy: Record<
    string,
    {
      count: number;
      wins: number;
      losses: number;
      win_rate: number;
      avg_r: number;
    }
  >;
}

// ── Localization ───────────────────────────────────────────────────────────

const STRATEGY_ZH: Record<string, string> = {
  trend_pullback_breakout: "顺势回调突破",
  wyckoff_liquidity_sweep: "流动性扫荡",
  ema_squeeze_launch: "EMA 蓄势启动",
  bollinger_extreme_reversion: "布林极值回归",
};

const REGIME_ZH: Record<string, string> = {
  strong_uptrend: "强趋势↑",
  strong_downtrend: "强趋势↓",
  squeeze_breakout_setup: "蓄势突破",
  ranging: "震荡",
  exhaustion_reversal: "衰竭",
  elevated_event_risk: "事件风险",
};

const EXIT_REASON_ZH: Record<string, string> = {
  target_1: "T1 达成",
  target_2: "T2 达成",
  stop: "止损",
  invalidation: "失效退出",
  trailing: "跟踪止损",
  time_stop: "时间止损",
  still_open: "持仓中",
};

// ── Page ───────────────────────────────────────────────────────────────────

export default function SignalJournalPage() {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const [history, setHistory] = useState<JournalSignal[]>([]);
  const [stats, setStats] = useState<StatsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [strategyFilter, setStrategyFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [days, setDays] = useState(30);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      days: String(days),
      limit: "200",
    });
    if (strategyFilter !== "all") params.set("strategy", strategyFilter);
    if (gradeFilter !== "all") params.set("grade", gradeFilter);
    try {
      const [h, s] = await Promise.all([
        fetch(`${API_BASE_URL}/v1/signals/journal/history?${params}`).then(
          (r) => r.json() as Promise<HistoryResp>,
        ),
        fetch(
          `${API_BASE_URL}/v1/signals/journal/stats?days=${days}${
            strategyFilter !== "all" ? `&strategy=${strategyFilter}` : ""
          }`,
        ).then((r) => r.json() as Promise<StatsResp>),
      ]);
      setHistory(h.signals || []);
      setStats(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, [strategyFilter, gradeFilter, days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const triggerSeed = useCallback(async () => {
    setSeeding(true);
    setSeedMsg(null);
    try {
      const r = await fetch(`${API_BASE_URL}/v1/signals/journal/scan-now`, {
        method: "POST",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setSeedMsg(
        isZh
          ? `扫描完成 — 入库 ${d.persisted ?? 0} 条 (跳过 ${d.skipped ?? 0})`
          : `Scanned. Persisted ${d.persisted ?? 0}, skipped ${d.skipped ?? 0}.`,
      );
      await fetchData();
    } catch (e) {
      setSeedMsg(
        isZh
          ? `失败：${e instanceof Error ? e.message : "?"}`
          : `Failed: ${e instanceof Error ? e.message : "?"}`,
      );
    } finally {
      setSeeding(false);
    }
  }, [fetchData, isZh]);

  const triggerOutcomes = useCallback(async () => {
    setSeeding(true);
    setSeedMsg(null);
    try {
      const r = await fetch(
        `${API_BASE_URL}/v1/signals/journal/update-outcomes`,
        { method: "POST" },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setSeedMsg(
        isZh
          ? `结果更新完成 — 检查 ${d.checked ?? 0} / 关闭 ${d.closed ?? 0} / 过期 ${d.expired ?? 0}`
          : `Checked ${d.checked ?? 0}, closed ${d.closed ?? 0}, expired ${d.expired ?? 0}.`,
      );
      await fetchData();
    } catch (e) {
      setSeedMsg(
        isZh
          ? `失败：${e instanceof Error ? e.message : "?"}`
          : `Failed: ${e instanceof Error ? e.message : "?"}`,
      );
    } finally {
      setSeeding(false);
    }
  }, [fetchData, isZh]);

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
              {isZh ? "信号复盘" : "Signal Journal"}
            </h1>
          </div>
          <p className="text-sm text-gray-400">
            {isZh
              ? "历史信号入库 + 胜率 / R 统计"
              : "Persisted history + win-rate / R stats"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={triggerSeed}
            disabled={seeding}
            className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {seeding ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {isZh ? "立即扫描入库" : "Scan & Persist Now"}
          </button>
          <button
            onClick={triggerOutcomes}
            disabled={seeding}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
          >
            <Activity className="h-3 w-3" />
            {isZh ? "更新结果" : "Update Outcomes"}
          </button>
        </div>
      </div>

      {seedMsg && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-4 py-2 text-xs text-cyan-200">
          {seedMsg}
        </div>
      )}

      {/* Stats summary */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <StatTile
            label={isZh ? "总信号" : "Total"}
            value={stats.total}
            tone="cyan"
          />
          <StatTile
            label={isZh ? "已结算" : "Closed"}
            value={stats.closed}
            tone="slate"
          />
          <StatTile
            label={isZh ? "胜率" : "Win Rate"}
            value={`${(stats.win_rate * 100).toFixed(1)}%`}
            tone={stats.win_rate >= 0.5 ? "emerald" : "amber"}
          />
          <StatTile
            label={isZh ? "平均 R" : "Avg R"}
            value={stats.avg_r.toFixed(2)}
            tone={stats.avg_r > 0 ? "emerald" : "red"}
          />
          <StatTile
            label={isZh ? "最佳 R" : "Best R"}
            value={stats.best_r.toFixed(2)}
            tone="emerald"
          />
          <StatTile
            label={isZh ? "最差 R" : "Worst R"}
            value={stats.worst_r.toFixed(2)}
            tone="red"
          />
        </div>
      )}

      {/* Per-grade breakdown */}
      {stats && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="mb-3 text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
            {isZh ? "按等级统计" : "By Grade"}
          </p>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
            {(["A", "B", "C"] as const).map((g) => {
              const s = stats.by_grade[g];
              if (!s || s.count === 0) {
                return (
                  <div
                    key={g}
                    className="rounded-lg border border-white/5 bg-white/[0.03] p-3"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <GradeChip grade={g} />
                      <span className="text-xs text-gray-500">
                        {isZh ? "无数据" : "no data"}
                      </span>
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={g}
                  className={`rounded-lg border p-3 ${
                    g === "A"
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : g === "B"
                        ? "border-amber-500/30 bg-amber-500/5"
                        : "border-white/10 bg-white/5"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GradeChip grade={g} />
                      <span className="text-xs text-gray-400">
                        {s.count} {isZh ? "笔" : "trades"}
                      </span>
                    </div>
                    <span
                      className={`text-sm font-bold tabular-nums ${
                        s.win_rate >= 0.5
                          ? "text-emerald-300"
                          : "text-amber-300"
                      }`}
                    >
                      {(s.win_rate * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-500">
                    <span>
                      {isZh ? "平均" : "avg"}:{" "}
                      <span className="text-gray-300">
                        {s.avg_r.toFixed(2)}R
                      </span>
                    </span>
                    <span>
                      W: {s.wins} / L: {s.losses}
                    </span>
                    <span>
                      {isZh ? "赢" : "win"}:{" "}
                      <span className="text-emerald-300">
                        {s.avg_winner_r.toFixed(2)}R
                      </span>
                    </span>
                    <span>
                      {isZh ? "输" : "loss"}:{" "}
                      <span className="text-red-300">
                        {s.avg_loser_r.toFixed(2)}R
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-strategy breakdown */}
      {stats && Object.keys(stats.by_strategy).length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="mb-3 text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
            {isZh ? "按策略统计" : "By Strategy"}
          </p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {Object.entries(stats.by_strategy).map(([k, s]) => (
              <div
                key={k}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3"
              >
                <div>
                  <p className="text-xs font-semibold text-cyan-300">
                    {STRATEGY_ZH[k] ?? k}
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {s.count} · W {s.wins}/L {s.losses}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`text-sm font-bold tabular-nums ${
                      s.win_rate >= 0.5 ? "text-emerald-300" : "text-amber-300"
                    }`}
                  >
                    {(s.win_rate * 100).toFixed(0)}%
                  </p>
                  <p
                    className={`font-mono text-[10px] tabular-nums ${
                      s.avg_r > 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {s.avg_r > 0 ? "+" : ""}
                    {s.avg_r.toFixed(2)}R
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
        <span className="font-semibold tracking-wider text-gray-500 uppercase">
          {isZh ? "策略" : "Strategy"}:
        </span>
        <select
          value={strategyFilter}
          onChange={(e) => setStrategyFilter(e.target.value)}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-white"
        >
          <option value="all">{isZh ? "全部" : "All"}</option>
          {Object.entries(STRATEGY_ZH).map(([k, v]) => (
            <option key={k} value={k}>
              {isZh ? v : k}
            </option>
          ))}
        </select>
        <span className="ml-2 font-semibold tracking-wider text-gray-500 uppercase">
          {isZh ? "等级" : "Grade"}:
        </span>
        {(["all", "A", "B", "C"] as const).map((g) => (
          <button
            key={g}
            onClick={() => setGradeFilter(g)}
            className={`rounded-md px-2 py-1 ${
              gradeFilter === g
                ? "bg-cyan-500 text-white"
                : "bg-white/5 text-gray-300 hover:bg-white/10"
            }`}
          >
            {g === "all" ? (isZh ? "全部" : "All") : g}
          </button>
        ))}
        <span className="ml-2 font-semibold tracking-wider text-gray-500 uppercase">
          {isZh ? "时间窗" : "Window"}:
        </span>
        {[7, 30, 90, 180].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`rounded-md px-2 py-1 ${
              days === d
                ? "bg-cyan-500 text-white"
                : "bg-white/5 text-gray-300 hover:bg-white/10"
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* History table */}
      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 py-12">
          <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      ) : history.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 py-12 text-center">
          <p className="text-sm text-gray-500">
            {isZh
              ? "无历史信号。点击「立即扫描入库」生成今天的信号样本。"
              : "No history yet. Click 'Scan & Persist Now' to seed today's signals."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          <table className="w-full text-xs">
            <thead className="bg-white/5 text-[10px] tracking-wider text-gray-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">
                  {isZh ? "日期" : "Date"}
                </th>
                <th className="px-3 py-2 text-left">{isZh ? "标的" : "Sym"}</th>
                <th className="px-3 py-2 text-left">
                  {isZh ? "策略" : "Strategy"}
                </th>
                <th className="px-3 py-2 text-center">{isZh ? "向" : "Dir"}</th>
                <th className="px-3 py-2 text-left">
                  {isZh ? "状态" : "Regime"}
                </th>
                <th className="px-3 py-2 text-right">
                  {isZh ? "评分" : "Score"}
                </th>
                <th className="px-3 py-2 text-right">
                  {isZh ? "入场" : "Entry"}
                </th>
                <th className="px-3 py-2 text-right">
                  {isZh ? "止损" : "Stop"}
                </th>
                <th className="px-3 py-2 text-right">T1/T2</th>
                <th className="px-3 py-2 text-right">
                  {isZh ? "结果" : "PnL"}
                </th>
                <th className="px-3 py-2 text-left">
                  {isZh ? "退出" : "Exit"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {history.map((s) => (
                <tr key={s.id} className="hover:bg-white/[0.03]">
                  <td className="px-3 py-2 text-gray-400">
                    {s.datetime.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/dashboard/stocks/${s.symbol}`}
                      className="font-mono font-semibold text-cyan-400 hover:underline"
                    >
                      {s.symbol}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-300">
                    {STRATEGY_ZH[s.strategy_name] ?? s.strategy_name}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {s.direction === "long" ? (
                      <TrendingUp className="inline h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <TrendingDown className="inline h-3.5 w-3.5 text-red-400" />
                    )}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-gray-400">
                    {REGIME_ZH[s.regime_at_signal] ?? s.regime_at_signal}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <GradeChip grade={s.score_grade} />
                      <span className="font-mono font-semibold text-white tabular-nums">
                        {s.score_total.toFixed(1)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-cyan-300 tabular-nums">
                    ${s.entry_price.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-red-300 tabular-nums">
                    ${s.stop_price.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-300 tabular-nums">
                    {s.target_1 ? `$${s.target_1.toFixed(2)}` : "—"}
                    {s.target_2 ? ` / $${s.target_2.toFixed(2)}` : ""}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {s.outcome?.pnl_r != null ? (
                      <span
                        className={`font-mono font-bold tabular-nums ${
                          s.outcome.pnl_r > 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {s.outcome.pnl_r > 0 ? "+" : ""}
                        {s.outcome.pnl_r.toFixed(2)}R
                      </span>
                    ) : s.status === "active" ? (
                      <span className="flex items-center justify-end gap-1 text-[10px] text-cyan-400">
                        <Clock className="h-3 w-3" />
                        {isZh ? "持仓" : "open"}
                      </span>
                    ) : s.status === "expired" ? (
                      <span className="text-[10px] text-gray-600">
                        {isZh ? "过期" : "expired"}
                      </span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-gray-500">
                    {s.outcome?.exit_reason
                      ? isZh
                        ? (EXIT_REASON_ZH[s.outcome.exit_reason] ??
                          s.outcome.exit_reason)
                        : s.outcome.exit_reason
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <p className="text-[10px] text-gray-600">
        {isZh
          ? "* 策略入场后按规则推演 (T1/T2/止损/失效/过期)，不考虑滑点和手续费。R = (出场价 - 入场价) / |入场 - 止损|"
          : "* Outcomes simulated rule-based (T1/T2/stop/invalidation/expiry); no slippage or fees. R = (exit-entry) / |entry-stop|."}
      </p>
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "cyan" | "emerald" | "amber" | "red" | "slate";
}) {
  const cls = {
    cyan: "text-cyan-400",
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    red: "text-red-400",
    slate: "text-slate-300",
  }[tone];
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="mb-1 text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
        {label}
      </p>
      <p className={`text-2xl font-bold tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

function GradeChip({ grade }: { grade: "A" | "B" | "C" }) {
  const cls = {
    A: "bg-emerald-500 text-white",
    B: "bg-amber-500 text-white",
    C: "bg-slate-500/40 text-slate-200",
  }[grade];
  return (
    <span
      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${cls}`}
    >
      {grade}
    </span>
  );
}
