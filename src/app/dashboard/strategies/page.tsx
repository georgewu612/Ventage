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
import { useI18n } from "@/lib/i18n/provider";

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

const CAT_STYLE: Record<string, { color: string; bg: string; border: string }> =
  {
    trend: {
      color: "text-cyan-400",
      bg: "bg-cyan-500/10",
      border: "border-cyan-500/20",
    },
    mean_reversion: {
      color: "text-purple-400",
      bg: "bg-purple-500/10",
      border: "border-purple-500/20",
    },
    momentum: {
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      border: "border-amber-500/20",
    },
    volatility: {
      color: "text-pink-400",
      bg: "bg-pink-500/10",
      border: "border-pink-500/20",
    },
  };

const STATUS_ICON_CLS: Record<string, string> = {
  pending: "bg-gray-500/20 text-gray-400",
  running: "bg-blue-500/20 text-blue-400",
  done: "bg-emerald-500/20 text-emerald-400",
  failed: "bg-red-500/20 text-red-400",
};

// ── Subcomponents ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Run["status"] }) {
  const { t } = useI18n();
  const cls = STATUS_ICON_CLS[status] ?? STATUS_ICON_CLS.pending;
  const icons: Record<string, React.ReactNode> = {
    pending: <Clock className="h-3 w-3" />,
    running: <Loader2 className="h-3 w-3 animate-spin" />,
    done: <CheckCircle2 className="h-3 w-3" />,
    failed: <XCircle className="h-3 w-3" />,
  };
  const labels: Record<string, string> = {
    pending: t("quant.statusPending"),
    running: t("quant.statusRunning"),
    done: t("quant.statusDone"),
    failed: t("quant.statusFailed"),
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {icons[status]}
      {labels[status]}
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function StrategiesPage() {
  const { t, locale } = useI18n();
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

  // Category label helper
  const catLabel = (category: string) => {
    const map: Record<string, string> = {
      trend: t("quant.catTrend"),
      mean_reversion: t("quant.catMeanReversion"),
      momentum: t("quant.catMomentum"),
      volatility: t("quant.catVolatility"),
    };
    return map[category] ?? category;
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
              <h1 className="text-2xl font-bold text-white">
                {t("nav.strategies")}
              </h1>
              <p className="mt-1 text-sm text-gray-400">
                {t("quant.templates")} · {t("quant.detail.params")} ·{" "}
                {t("quant.runHistory")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={refreshRuns}
                className="rounded-lg border border-white/10 p-2 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
                title={t("common.refresh")}
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              <Link
                href="/dashboard/quant-lab"
                className="flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-400"
              >
                <Play className="h-4 w-4" />
                {t("quant.newBacktest")}
              </Link>
            </div>
          </div>

          {/* ── Stats Bar ── */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              {
                label: t("quant.statsTotal"),
                value: runs.length,
                color: "text-white",
                bg: "bg-white/5",
                border: "border-white/10",
              },
              {
                label: t("quant.statsDone"),
                value: doneRuns.length,
                color: "text-emerald-400",
                bg: "bg-emerald-500/5",
                border: "border-emerald-500/20",
              },
              {
                label: t("quant.statsRunning"),
                value: activeRuns.length,
                color: "text-blue-400",
                bg: "bg-blue-500/5",
                border: "border-blue-500/20",
              },
              {
                label: t("quant.statsFailed"),
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
              {t("quant.templates")}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {templates.map((tmpl) => {
                const cat = CAT_STYLE[tmpl.category] ?? CAT_STYLE.trend;
                return (
                  <div
                    key={tmpl.id}
                    className={`rounded-2xl border ${cat.border} ${cat.bg} p-5 transition-all hover:opacity-90`}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span
                        className={`text-[10px] font-semibold ${cat.color} tracking-wider uppercase`}
                      >
                        {catLabel(tmpl.category)}
                      </span>
                      <FlaskConical className={`h-4 w-4 ${cat.color}`} />
                    </div>
                    <h3 className="mb-1.5 font-semibold text-white">
                      {locale === "zh" ? tmpl.name_zh : tmpl.name}
                    </h3>
                    <p className="mb-4 text-xs leading-relaxed text-gray-500">
                      {tmpl.description}
                    </p>
                    <Link
                      href="/dashboard/quant-lab"
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-black/40"
                    >
                      <Play className="h-3 w-3" />
                      {t("quant.run")}
                    </Link>
                  </div>
                );
              })}
              {templates.length === 0 && (
                <div className="col-span-4 py-10 text-center text-sm text-gray-600">
                  {t("quant.loadingTemplates")}
                </div>
              )}
            </div>
          </section>

          {/* ── Run History ── */}
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wider text-gray-500 uppercase">
                {t("quant.runHistory")}
              </h2>
              {runs.length > 0 && (
                <span className="text-xs text-gray-600">
                  {runs.length} {t("quant.records")}
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
                <p className="text-gray-500">{t("quant.noRuns")}</p>
                <p className="mt-1 text-sm text-gray-600">
                  {t("quant.noRunsHint")}
                </p>
                <Link
                  href="/dashboard/quant-lab"
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-cyan-500/20 px-5 py-2.5 text-sm font-medium text-cyan-300 hover:bg-cyan-500/30"
                >
                  <Play className="h-4 w-4" />
                  {t("quant.goToQuantLab")}
                </Link>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {[
                        t("quant.strategy"),
                        t("quant.symbol"),
                        t("quant.period"),
                        t("common.status"),
                        t("quant.duration"),
                        "",
                      ].map((h, i) => (
                        <th
                          key={i}
                          className="px-4 py-3 text-left text-xs font-semibold text-gray-500"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {runs.map((run) => {
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
                            {run.template_name}
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
                                {t("quant.viewResult")}
                                <TrendingUp className="h-3 w-3 text-emerald-400 opacity-0 group-hover:opacity-100" />
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
