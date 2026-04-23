"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BarChart2,
  CheckCircle2,
  Clock,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";

import { API_BASE_URL } from "@/lib/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { FeatureGate } from "@/components/ui/FeatureGate";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Template {
  id: string;
  name: string;
  name_zh: string;
  description: string;
  category: string;
}

interface Run {
  id: string;
  template_name: string;
  symbol: string;
  start_date: string;
  end_date: string;
  status: "pending" | "running" | "done" | "failed";
  created_at: string;
  finished_at: string | null;
}

// ── Config ─────────────────────────────────────────────────────────────────────

const CAT: Record<
  string,
  { label: string; color: string; bg: string; border: string }
> = {
  trend: {
    label: "趋势",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
  },
  mean_reversion: {
    label: "均值回归",
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
  },
  momentum: {
    label: "动量",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  volatility: {
    label: "波动率",
    color: "text-pink-400",
    bg: "bg-pink-500/10",
    border: "border-pink-500/20",
  },
};

const STATUS_CFG = {
  pending: {
    icon: <Clock className="h-3 w-3" />,
    label: "等待中",
    cls: "bg-gray-500/20 text-gray-400",
  },
  running: {
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    label: "运行中",
    cls: "bg-blue-500/20 text-blue-400",
  },
  done: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    label: "完成",
    cls: "bg-emerald-500/20 text-emerald-400",
  },
  failed: {
    icon: <XCircle className="h-3 w-3" />,
    label: "失败",
    cls: "bg-red-500/20 text-red-400",
  },
};

const STRATEGY_NAME_MAP: Record<string, string> = {
  sma_crossover: "双均线交叉",
  rsi_mean_reversion: "RSI 均值回归",
  bollinger_band: "布林带突破",
  macd_momentum: "MACD 动量",
};

// ── Subcomponents ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Run["status"] }) {
  const cfg = STATUS_CFG[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.cls}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function StrategiesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE_URL}/v1/strategies/templates`)
      .then((r) => r.json())
      .then(setTemplates)
      .catch(() => {});

    createSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (user) setUserId(user.id);
      });
  }, []);

  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      setLoadingRuns(true);
      try {
        const r = await fetch(
          `${API_BASE_URL}/v1/strategies/runs?user_id=${userId}&limit=50`,
        );
        const data = await r.json();
        setRuns(Array.isArray(data) ? data : []);
      } catch {
        // ignore
      } finally {
        setLoadingRuns(false);
      }
    };
    load();
  }, [userId]);

  const refreshRuns = async () => {
    if (!userId) return;
    setLoadingRuns(true);
    try {
      const r = await fetch(
        `${API_BASE_URL}/v1/strategies/runs?user_id=${userId}&limit=50`,
      );
      const data = await r.json();
      setRuns(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    } finally {
      setLoadingRuns(false);
    }
  };

  // Stats
  const doneRuns = runs.filter((r) => r.status === "done");
  const failedRuns = runs.filter((r) => r.status === "failed");
  const activeRuns = runs.filter(
    (r) => r.status === "pending" || r.status === "running",
  );

  return (
    <FeatureGate feature="quant_lab" overlay>
      <div className="min-h-screen p-6">
        <div className="mx-auto max-w-6xl space-y-8">
          {/* ── Header ── */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">策略中心</h1>
              <p className="mt-1 text-sm text-gray-400">
                量化策略回测 · 参数研究 · 历史验证
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={refreshRuns}
                className="rounded-lg border border-white/10 p-2 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
                title="刷新"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              <Link
                href="/dashboard/quant-lab"
                className="flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-400"
              >
                <Play className="h-4 w-4" />
                新建回测
              </Link>
            </div>
          </div>

          {/* ── Stats Bar ── */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              {
                label: "总回测次数",
                value: runs.length,
                color: "text-white",
                bg: "bg-white/5",
                border: "border-white/10",
              },
              {
                label: "已完成",
                value: doneRuns.length,
                color: "text-emerald-400",
                bg: "bg-emerald-500/5",
                border: "border-emerald-500/20",
              },
              {
                label: "进行中",
                value: activeRuns.length,
                color: "text-blue-400",
                bg: "bg-blue-500/5",
                border: "border-blue-500/20",
              },
              {
                label: "失败",
                value: failedRuns.length,
                color: "text-red-400",
                bg: "bg-red-500/5",
                border: "border-red-500/20",
              },
            ].map(({ label, value, color, bg, border }) => (
              <div
                key={label}
                className={`rounded-2xl border ${border} ${bg} p-4`}
              >
                <p className="mb-1 text-xs font-medium text-gray-500">
                  {label}
                </p>
                <p className={`text-3xl font-bold tabular-nums ${color}`}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* ── Strategy Templates ── */}
          <section>
            <h2 className="mb-4 text-xs font-semibold tracking-wider text-gray-500 uppercase">
              可用策略模板
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {templates.map((t) => {
                const cat = CAT[t.category] ?? CAT.trend;
                return (
                  <div
                    key={t.id}
                    className={`rounded-2xl border ${cat.border} ${cat.bg} p-5 transition-all hover:opacity-90`}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span
                        className={`text-[10px] font-semibold ${cat.color} tracking-wider uppercase`}
                      >
                        {cat.label}
                      </span>
                      <FlaskConical className={`h-4 w-4 ${cat.color}`} />
                    </div>
                    <h3 className="mb-1.5 font-semibold text-white">
                      {t.name_zh}
                    </h3>
                    <p className="mb-4 text-xs leading-relaxed text-gray-500">
                      {t.description}
                    </p>
                    <Link
                      href="/dashboard/quant-lab"
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-black/40"
                    >
                      <Play className="h-3 w-3" />
                      运行此策略
                    </Link>
                  </div>
                );
              })}
              {templates.length === 0 && (
                <div className="col-span-4 py-10 text-center text-sm text-gray-600">
                  正在加载策略模板…
                </div>
              )}
            </div>
          </section>

          {/* ── Run History ── */}
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wider text-gray-500 uppercase">
                回测历史
              </h2>
              {runs.length > 0 && (
                <span className="text-xs text-gray-600">
                  共 {runs.length} 条记录
                </span>
              )}
            </div>

            {loadingRuns ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
              </div>
            ) : runs.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 py-20 text-center">
                <BarChart2 className="mx-auto mb-4 h-10 w-10 text-gray-700" />
                <p className="text-gray-500">还没有任何回测记录</p>
                <p className="mt-1 text-sm text-gray-600">
                  点击&ldquo;新建回测&rdquo;从策略模板开始
                </p>
                <Link
                  href="/dashboard/quant-lab"
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-cyan-500/20 px-5 py-2.5 text-sm font-medium text-cyan-300 hover:bg-cyan-500/30"
                >
                  <Play className="h-4 w-4" />
                  前往 Quant Lab
                </Link>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {["策略", "标的", "回测区间", "状态", "运行时间", ""].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-4 py-3 text-left text-xs font-semibold text-gray-500"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {runs.map((run) => {
                      const displayName =
                        STRATEGY_NAME_MAP[run.template_name] ??
                        run.template_name;
                      const duration =
                        run.finished_at && run.created_at
                          ? `${Math.round(
                              (new Date(run.finished_at).getTime() -
                                new Date(run.created_at).getTime()) /
                                1000,
                            )}s`
                          : "—";

                      return (
                        <tr
                          key={run.id}
                          className="group hover:bg-white/[0.03]"
                        >
                          <td className="px-4 py-3 text-sm font-medium text-gray-200">
                            {displayName}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-sm font-semibold text-cyan-400">
                              ${run.symbol}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {run.start_date?.slice(0, 10)} →{" "}
                            {run.end_date?.slice(0, 10)}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={run.status} />
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600">
                            {duration}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {run.status === "done" && (
                              <Link
                                href={`/dashboard/strategies/${run.id}`}
                                className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
                              >
                                查看结果
                                {run.status === "done" && (
                                  <>
                                    <TrendingUp className="h-3 w-3 text-emerald-400 opacity-0 group-hover:opacity-100" />
                                  </>
                                )}
                              </Link>
                            )}
                            {(run.status === "pending" ||
                              run.status === "running") && (
                              <Loader2 className="ml-auto h-4 w-4 animate-spin text-blue-400" />
                            )}
                            {run.status === "failed" && (
                              <TrendingDown className="ml-auto h-4 w-4 text-red-500/50" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </FeatureGate>
  );
}
