"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BarChart2,
  Bot,
  CheckCircle2,
  Clock,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";

import { API_BASE_URL } from "@/lib/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { FeatureGate } from "@/components/ui/FeatureGate";
import { useI18n } from "@/lib/i18n/provider";
import { useMarketRegime } from "@/lib/hooks/useMarketRegime";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Template {
  id: string;
  name: string;
  name_zh: string;
  description: string;
  category: string;
}

interface MatchResult {
  template_id: string;
  name: string;
  score: number;
  reason: string;
  reason_en: string;
}

interface MatchResponse {
  regime: string;
  volatility: string;
  style?: string;
  top_matches: MatchResult[];
  excluded: MatchResult[];
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

// ── Regime Fit helper ────────────────────────────────────────────────────────

function getRegimeFit(
  category: string,
  regime: string,
): { label: string; color: string } {
  const good = [
    ["trend", "risk_on"],
    ["momentum", "risk_on"],
    ["volatility", "risk_off"],
    ["mean_reversion", "neutral"],
    ["mean_reversion", "risk_off"],
  ];
  const bad = [
    ["momentum", "risk_off"],
    ["trend", "risk_off"],
    ["volatility", "risk_on"],
  ];
  const key = `${category},${regime}`;
  if (good.some(([c, r]) => `${c},${r}` === key))
    return { label: "高适配", color: "text-emerald-400 bg-emerald-500/10" };
  if (bad.some(([c, r]) => `${c},${r}` === key))
    return { label: "低适配", color: "text-red-400 bg-red-500/10" };
  return { label: "中性", color: "text-gray-400 bg-white/5" };
}

export default function StrategiesPage() {
  const { t, locale } = useI18n();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);

  // AI Strategy Match state
  const [riskPref, setRiskPref] = useState("moderate");
  const [maxDd, setMaxDd] = useState(12);
  const [matching, setMatching] = useState(false);
  const [matchResult, setMatchResult] = useState<MatchResponse | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const { regime } = useMarketRegime();

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

  const runMatch = async () => {
    setMatching(true);
    setMatchError(null);
    setMatchResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/strategies/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          risk_preference: riskPref,
          max_drawdown_pct: maxDd,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMatchResult(data);
    } catch (e) {
      setMatchError((e as Error).message);
    } finally {
      setMatching(false);
    }
  };

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

          {/* ── AI Strategy Match ── */}
          <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-5">
            <div className="mb-4 flex items-center gap-2">
              <Bot className="h-5 w-5 text-cyan-400" />
              <h2 className="text-sm font-semibold text-white">
                {t("quant.aiMatch.title")}
              </h2>
              {regime && (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-gray-400">
                  {t("quant.aiMatch.currentRegime")}:{" "}
                  <span className="font-semibold text-cyan-300">
                    {regime.regime}
                  </span>
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-4">
              {/* Risk preference */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">
                  {t("quant.aiMatch.riskPreference")}
                </label>
                <select
                  value={riskPref}
                  onChange={(e) => setRiskPref(e.target.value)}
                  className="rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-sm text-white"
                >
                  {[
                    ["conservative", "保守型"],
                    ["moderate", "稳健型"],
                    ["balanced", "平衡型"],
                    ["aggressive", "进取型"],
                    ["speculative", "激进型"],
                  ].map(([v, zh]) => (
                    <option key={v} value={v}>
                      {locale === "zh" ? zh : v}
                    </option>
                  ))}
                </select>
              </div>
              {/* Max drawdown */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">
                  {t("quant.aiMatch.maxDrawdown")}: {maxDd}%
                </label>
                <input
                  type="range"
                  min={5}
                  max={25}
                  step={1}
                  value={maxDd}
                  onChange={(e) => setMaxDd(Number(e.target.value))}
                  className="w-32 accent-cyan-500"
                />
              </div>
              <button
                onClick={runMatch}
                disabled={matching}
                className="flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-400 disabled:opacity-60"
              >
                {matching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                {matching
                  ? t("quant.aiMatch.matching")
                  : t("quant.aiMatch.match")}
              </button>
            </div>

            {matchError && (
              <p className="mt-3 text-xs text-red-400">{matchError}</p>
            )}

            {matchResult && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold text-cyan-300">
                  {t("quant.aiMatch.topMatches")} (
                  {matchResult.top_matches.length})
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {matchResult.top_matches.map((m) => (
                    <div
                      key={m.template_id}
                      className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3"
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-semibold text-white">
                          {m.name}
                        </span>
                        <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                          {m.score}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-400">
                        {locale === "zh" ? m.reason : m.reason_en}
                      </p>
                      <span className="mt-1 inline-block rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">
                        AI推荐
                      </span>
                    </div>
                  ))}
                </div>
                {matchResult.excluded.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300">
                      {t("quant.aiMatch.excluded")} (
                      {matchResult.excluded.length})
                    </summary>
                    <div className="mt-2 space-y-1">
                      {matchResult.excluded.map((m) => (
                        <div
                          key={m.template_id}
                          className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-1.5"
                        >
                          <span className="text-xs text-gray-400">
                            {m.name}
                          </span>
                          <span className="text-[10px] text-gray-600">
                            {locale === "zh" ? m.reason : m.reason_en}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </section>

          {/* ── Strategy Templates ── */}
          <section>
            <h2 className="mb-4 text-xs font-semibold tracking-wider text-gray-500 uppercase">
              {t("quant.templates")}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {templates.map((tmpl) => {
                const cat = CAT_STYLE[tmpl.category] ?? CAT_STYLE.trend;
                const regimeFit = getRegimeFit(
                  tmpl.category,
                  regime?.regime ?? "neutral",
                );
                const isAiRecommended = matchResult?.top_matches.some(
                  (m) => m.template_id === tmpl.id,
                );
                return (
                  <div
                    key={tmpl.id}
                    className={`relative rounded-2xl border ${cat.border} ${cat.bg} p-5 transition-all hover:opacity-90 ${isAiRecommended ? "ring-1 ring-emerald-500/40" : ""}`}
                  >
                    {isAiRecommended && (
                      <div className="absolute -top-2 right-3">
                        <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[9px] font-bold text-white">
                          AI推荐
                        </span>
                      </div>
                    )}
                    <div className="mb-3 flex items-center justify-between">
                      <span
                        className={`text-[10px] font-semibold ${cat.color} tracking-wider uppercase`}
                      >
                        {catLabel(tmpl.category)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${regimeFit.color}`}
                        >
                          {regimeFit.label}
                        </span>
                        <FlaskConical className={`h-4 w-4 ${cat.color}`} />
                      </div>
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
