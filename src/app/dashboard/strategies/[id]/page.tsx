"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BarChart2,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import Link from "next/link";

import { API_BASE_URL } from "@/lib/config";
import { FeatureGate } from "@/components/ui/FeatureGate";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RunInfo {
  id: string;
  template_name: string;
  symbol: string;
  start_date: string;
  end_date: string;
  status: "pending" | "running" | "done" | "failed";
  params: Record<string, number>;
  created_at: string;
  finished_at: string | null;
  error_msg?: string | null;
}

interface Results {
  total_return: number;
  annualized_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
  total_trades: number;
  profit_factor: number;
  equity_curve: { date: string; value: number }[];
}

interface Trade {
  id: string;
  entry_date: string;
  exit_date: string;
  side: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  pnl: number;
  pnl_pct: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pct(v: number) {
  return `${(v * 100).toFixed(2)}%`;
}

function sign(v: number) {
  return v >= 0 ? "+" : "";
}

// ── Subcomponents ──────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  positive,
  sub,
}: {
  label: string;
  value: string;
  positive?: boolean;
  sub?: string;
}) {
  const color =
    positive === undefined
      ? "text-white"
      : positive
        ? "text-emerald-400"
        : "text-red-400";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="mb-1 text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
        {label}
      </p>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-600">{sub}</p>}
    </div>
  );
}

function EquityChart({ data }: { data: { date: string; value: number }[] }) {
  if (!data || data.length < 2)
    return (
      <div className="flex h-48 items-center justify-center text-sm text-gray-600">
        无权益曲线数据
      </div>
    );

  const values = data.map((d) => d.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const W = 800;
  const H = 180;
  const pad = { x: 8, y: 12 };

  const pts = data
    .map((d, i) => {
      const x = pad.x + (i / (data.length - 1)) * (W - 2 * pad.x);
      const y = pad.y + ((maxV - d.value) / range) * (H - 2 * pad.y);
      return `${x},${y}`;
    })
    .join(" ");

  // Filled area
  const firstX = pad.x;
  const lastX = pad.x + (W - 2 * pad.x);
  const baselineY = H - pad.y;
  const area =
    `M${firstX},${baselineY} ` +
    pts
      .split(" ")
      .map((p, i) => `${i === 0 ? "L" : "L"}${p}`)
      .join(" ") +
    ` L${lastX},${baselineY} Z`;

  const isUp = values[values.length - 1] >= values[0];
  const color = isUp ? "#34d399" : "#f87171";
  const fillId = isUp ? "fillGreen" : "fillRed";

  // Baseline at value=1
  const baselineAtOne = pad.y + ((maxV - 1) / range) * (H - 2 * pad.y);

  return (
    <div className="w-full overflow-hidden rounded-xl bg-black/20 p-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Baseline */}
        <line
          x1={pad.x}
          y1={baselineAtOne}
          x2={W - pad.x}
          y2={baselineAtOne}
          stroke="#ffffff18"
          strokeWidth="1"
          strokeDasharray="6 4"
        />
        {/* Filled area */}
        <path d={area} fill={`url(#${fillId})`} />
        {/* Line */}
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function StatusBadge({ status }: { status: RunInfo["status"] }) {
  const cfg: Record<
    RunInfo["status"],
    { cls: string; icon: React.ReactNode; label: string }
  > = {
    pending: {
      cls: "bg-gray-500/20 text-gray-300",
      icon: <Clock className="h-3 w-3" />,
      label: "等待中",
    },
    running: {
      cls: "bg-blue-500/20 text-blue-400",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      label: "运行中",
    },
    done: {
      cls: "bg-emerald-500/20 text-emerald-400",
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: "完成",
    },
    failed: {
      cls: "bg-red-500/20 text-red-400",
      icon: <XCircle className="h-3 w-3" />,
      label: "失败",
    },
  };
  const c = cfg[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${c.cls}`}
    >
      {c.icon}
      {c.label}
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function StrategyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.id as string;

  const [run, setRun] = useState<RunInfo | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/v1/strategies/runs/${runId}`);
      if (!res.ok) throw new Error("回测记录不存在");
      const data = await res.json();
      setRun(data.run);
      setResults(data.results ?? null);
      setTrades(data.trades ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (runId) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Auto-poll while running
  useEffect(() => {
    if (!run || run.status === "done" || run.status === "failed") return;
    const timer = setInterval(fetchData, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <div className="text-4xl">⚠️</div>
        <p className="text-red-400">{error ?? "回测记录不存在"}</p>
        <button
          onClick={() => router.back()}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20"
        >
          返回
        </button>
      </div>
    );
  }

  const catMap: Record<string, string> = {
    sma_crossover: "双均线交叉",
    rsi_mean_reversion: "RSI 均值回归",
    bollinger_band: "布林带突破",
    macd_momentum: "MACD 动量",
  };

  return (
    <FeatureGate feature="quant_lab" overlay>
      <div className="min-h-screen p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* ── Breadcrumb & Header ── */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Link
                href="/dashboard/quant-lab"
                className="mb-2 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300"
              >
                <ArrowLeft className="h-4 w-4" />
                Quant Lab
              </Link>
              <h1 className="text-2xl font-bold text-white">
                {catMap[run.template_name] ?? run.template_name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-400">
                <span className="font-mono font-semibold text-cyan-400">
                  ${run.symbol}
                </span>
                <span>·</span>
                <span>
                  {run.start_date} → {run.end_date}
                </span>
                <span>·</span>
                <StatusBadge status={run.status} />
              </div>
            </div>
            <button
              onClick={() => router.push("/dashboard/quant-lab")}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-300 hover:bg-white/10"
            >
              <Play className="h-4 w-4 text-cyan-400" />
              新建回测
            </button>
          </div>

          {/* ── Running / Pending state ── */}
          {(run.status === "pending" || run.status === "running") && (
            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-8 text-center">
              <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-blue-400" />
              <p className="text-lg font-semibold text-white">
                {run.status === "pending" ? "排队中，等待执行…" : "回测运行中…"}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                每 5 秒自动刷新，完成后结果将显示在此处
              </p>
            </div>
          )}

          {/* ── Failed state ── */}
          {run.status === "failed" && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
              <p className="font-semibold text-red-400">回测执行失败</p>
              {run.error_msg && (
                <p className="mt-1 text-sm text-gray-500">{run.error_msg}</p>
              )}
            </div>
          )}

          {/* ── Results ── */}
          {run.status === "done" && results && (
            <>
              {/* Key Metrics */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <MetricCard
                  label="总收益率"
                  value={`${sign(results.total_return)}${pct(results.total_return)}`}
                  positive={results.total_return > 0}
                />
                <MetricCard
                  label="年化收益"
                  value={`${sign(results.annualized_return)}${pct(results.annualized_return)}`}
                  positive={results.annualized_return > 0}
                />
                <MetricCard
                  label="夏普比率"
                  value={results.sharpe_ratio.toFixed(2)}
                  positive={results.sharpe_ratio > 1}
                  sub={
                    results.sharpe_ratio > 2
                      ? "优秀"
                      : results.sharpe_ratio > 1
                        ? "良好"
                        : "偏低"
                  }
                />
                <MetricCard
                  label="最大回撤"
                  value={pct(Math.abs(results.max_drawdown))}
                  positive={false}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <MetricCard
                  label="胜率"
                  value={pct(results.win_rate)}
                  positive={results.win_rate > 0.5}
                />
                <MetricCard
                  label="总交易次数"
                  value={String(results.total_trades)}
                />
                <MetricCard
                  label="盈亏比"
                  value={results.profit_factor.toFixed(2)}
                  positive={results.profit_factor > 1}
                  sub={
                    results.profit_factor > 2
                      ? "优秀"
                      : results.profit_factor > 1.5
                        ? "良好"
                        : "偏低"
                  }
                />
              </div>

              {/* Equity Curve */}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-semibold text-white">权益曲线</h2>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {results.total_return >= 0 ? (
                      <TrendingUp className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-400" />
                    )}
                    <span>
                      初始净值 1.0 →{" "}
                      <span
                        className={
                          results.total_return >= 0
                            ? "font-semibold text-emerald-400"
                            : "font-semibold text-red-400"
                        }
                      >
                        {(1 + results.total_return).toFixed(4)}
                      </span>
                    </span>
                  </div>
                </div>
                <EquityChart data={results.equity_curve} />
              </div>

              {/* Trade Log */}
              {trades.length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/5">
                  <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                    <h2 className="font-semibold text-white">
                      交易记录{" "}
                      <span className="ml-2 text-sm text-gray-500">
                        (最近 {trades.length} 笔)
                      </span>
                    </h2>
                    <BarChart2 className="h-4 w-4 text-gray-600" />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/5 text-xs text-gray-600">
                          {[
                            "方向",
                            "入场日期",
                            "出场日期",
                            "入场价",
                            "出场价",
                            "数量",
                            "盈亏",
                            "盈亏%",
                          ].map((h) => (
                            <th
                              key={h}
                              className="px-4 py-3 text-left font-semibold"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {trades.map((t, i) => {
                          const isWin = t.pnl >= 0;
                          return (
                            <tr
                              key={t.id ?? i}
                              className="hover:bg-white/[0.03]"
                            >
                              <td className="px-4 py-2">
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                    t.side === "long"
                                      ? "bg-emerald-500/15 text-emerald-400"
                                      : "bg-red-500/15 text-red-400"
                                  }`}
                                >
                                  {t.side === "long" ? "做多" : "做空"}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-gray-400">
                                {t.entry_date?.slice(0, 10)}
                              </td>
                              <td className="px-4 py-2 text-gray-400">
                                {t.exit_date?.slice(0, 10)}
                              </td>
                              <td className="px-4 py-2 text-gray-300 tabular-nums">
                                ${t.entry_price?.toFixed(2)}
                              </td>
                              <td className="px-4 py-2 text-gray-300 tabular-nums">
                                ${t.exit_price?.toFixed(2)}
                              </td>
                              <td className="px-4 py-2 text-gray-500 tabular-nums">
                                {t.quantity?.toFixed(0)}
                              </td>
                              <td
                                className={`px-4 py-2 font-semibold tabular-nums ${
                                  isWin ? "text-emerald-400" : "text-red-400"
                                }`}
                              >
                                {sign(t.pnl)}${Math.abs(t.pnl).toFixed(0)}
                              </td>
                              <td
                                className={`px-4 py-2 tabular-nums ${
                                  isWin ? "text-emerald-400" : "text-red-400"
                                }`}
                              >
                                {sign(t.pnl_pct)}
                                {(t.pnl_pct * 100).toFixed(2)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Strategy Params used */}
              {run.params && Object.keys(run.params).length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <h2 className="mb-3 font-semibold text-white">使用参数</h2>
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(run.params).map(([k, v]) => (
                      <div
                        key={k}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                      >
                        <p className="text-[10px] text-gray-500">{k}</p>
                        <p className="font-mono font-semibold text-cyan-400">
                          {v}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </FeatureGate>
  );
}
