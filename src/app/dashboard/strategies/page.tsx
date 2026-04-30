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
import { useTheme } from "@/lib/theme/provider";
import { useMarketRegime } from "@/lib/hooks/useMarketRegime";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Template {
  id: string;
  name: string;
  name_zh: string;
  description: string;
  description_zh?: string;
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

// Per-template visual theme keyed by template `name` (English).
interface TplTheme {
  card: string;
  hover: string;
  accentBar: string;
  iconColor: string;
  buttonClass: string;
  ringColor: string;
}
const TPL_THEMES_DARK: Record<string, TplTheme> = {
  sma_crossover: {
    card: "border-cyan-400/25 bg-gradient-to-br from-cyan-950/40 via-slate-900/30 to-cyan-950/20",
    hover: "hover:border-cyan-400/50",
    accentBar: "bg-gradient-to-r from-cyan-500 via-sky-400 to-blue-500",
    iconColor: "text-cyan-400",
    buttonClass:
      "bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-400/30",
    ringColor: "shadow-cyan-500/10",
  },
  rsi_mean_reversion: {
    card: "border-purple-400/25 bg-gradient-to-br from-purple-950/40 via-slate-900/30 to-purple-950/20",
    hover: "hover:border-purple-400/50",
    accentBar: "bg-gradient-to-r from-purple-500 via-fuchsia-400 to-pink-500",
    iconColor: "text-purple-400",
    buttonClass:
      "bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-400/30",
    ringColor: "shadow-purple-500/10",
  },
  bollinger_band: {
    card: "border-indigo-400/25 bg-gradient-to-br from-indigo-950/40 via-slate-900/30 to-indigo-950/20",
    hover: "hover:border-indigo-400/50",
    accentBar: "bg-gradient-to-r from-indigo-500 via-blue-400 to-violet-500",
    iconColor: "text-indigo-400",
    buttonClass:
      "bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-400/30",
    ringColor: "shadow-indigo-500/10",
  },
  macd_signal: {
    card: "border-amber-400/25 bg-gradient-to-br from-amber-950/40 via-slate-900/30 to-amber-950/20",
    hover: "hover:border-amber-400/50",
    accentBar: "bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-500",
    iconColor: "text-amber-400",
    buttonClass:
      "bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/30",
    ringColor: "shadow-amber-500/10",
  },
  "Momentum Breakout": {
    card: "border-orange-400/25 bg-gradient-to-br from-orange-950/40 via-slate-900/30 to-red-950/20",
    hover: "hover:border-orange-400/50",
    accentBar: "bg-gradient-to-r from-orange-500 via-red-500 to-pink-500",
    iconColor: "text-orange-400",
    buttonClass:
      "bg-orange-500/20 hover:bg-orange-500/30 text-orange-200 border border-orange-400/30",
    ringColor: "shadow-orange-500/10",
  },
  "Low Volatility Defense": {
    card: "border-emerald-400/25 bg-gradient-to-br from-emerald-950/40 via-slate-900/30 to-teal-950/20",
    hover: "hover:border-emerald-400/50",
    accentBar: "bg-gradient-to-r from-emerald-500 via-teal-400 to-green-500",
    iconColor: "text-emerald-400",
    buttonClass:
      "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-400/30",
    ringColor: "shadow-emerald-500/10",
  },
};
TPL_THEMES_DARK.momentum_breakout = TPL_THEMES_DARK["Momentum Breakout"];
TPL_THEMES_DARK.low_volatility_defense =
  TPL_THEMES_DARK["Low Volatility Defense"];

const TPL_THEMES_LIGHT: Record<string, TplTheme> = {
  sma_crossover: {
    card: "border-cyan-300 bg-gradient-to-br from-cyan-50 via-white to-sky-50",
    hover: "hover:border-cyan-400 hover:shadow-cyan-200/40",
    accentBar: "bg-gradient-to-r from-cyan-500 via-sky-400 to-blue-500",
    iconColor: "text-cyan-600",
    buttonClass:
      "bg-cyan-500 hover:bg-cyan-600 text-white border border-cyan-600/20",
    ringColor: "shadow-cyan-200/30",
  },
  rsi_mean_reversion: {
    card: "border-purple-300 bg-gradient-to-br from-purple-50 via-white to-fuchsia-50",
    hover: "hover:border-purple-400 hover:shadow-purple-200/40",
    accentBar: "bg-gradient-to-r from-purple-500 via-fuchsia-400 to-pink-500",
    iconColor: "text-purple-600",
    buttonClass:
      "bg-purple-500 hover:bg-purple-600 text-white border border-purple-600/20",
    ringColor: "shadow-purple-200/30",
  },
  bollinger_band: {
    card: "border-indigo-300 bg-gradient-to-br from-indigo-50 via-white to-violet-50",
    hover: "hover:border-indigo-400 hover:shadow-indigo-200/40",
    accentBar: "bg-gradient-to-r from-indigo-500 via-blue-400 to-violet-500",
    iconColor: "text-indigo-600",
    buttonClass:
      "bg-indigo-500 hover:bg-indigo-600 text-white border border-indigo-600/20",
    ringColor: "shadow-indigo-200/30",
  },
  macd_signal: {
    card: "border-amber-300 bg-gradient-to-br from-amber-50 via-white to-orange-50",
    hover: "hover:border-amber-400 hover:shadow-amber-200/40",
    accentBar: "bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-500",
    iconColor: "text-amber-600",
    buttonClass:
      "bg-amber-500 hover:bg-amber-600 text-white border border-amber-600/20",
    ringColor: "shadow-amber-200/30",
  },
  "Momentum Breakout": {
    card: "border-orange-300 bg-gradient-to-br from-orange-50 via-white to-red-50",
    hover: "hover:border-orange-400 hover:shadow-orange-200/40",
    accentBar: "bg-gradient-to-r from-orange-500 via-red-500 to-pink-500",
    iconColor: "text-orange-600",
    buttonClass:
      "bg-orange-500 hover:bg-orange-600 text-white border border-orange-600/20",
    ringColor: "shadow-orange-200/30",
  },
  "Low Volatility Defense": {
    card: "border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-teal-50",
    hover: "hover:border-emerald-400 hover:shadow-emerald-200/40",
    accentBar: "bg-gradient-to-r from-emerald-500 via-teal-400 to-green-500",
    iconColor: "text-emerald-600",
    buttonClass:
      "bg-emerald-500 hover:bg-emerald-600 text-white border border-emerald-600/20",
    ringColor: "shadow-emerald-200/30",
  },
};
TPL_THEMES_LIGHT.momentum_breakout = TPL_THEMES_LIGHT["Momentum Breakout"];
TPL_THEMES_LIGHT.low_volatility_defense =
  TPL_THEMES_LIGHT["Low Volatility Defense"];

const TPL_DEFAULT: TplTheme = {
  card: "border-white/10 bg-white/5",
  hover: "hover:border-white/20",
  accentBar: "bg-gradient-to-r from-slate-500 to-slate-400",
  iconColor: "text-gray-400",
  buttonClass:
    "bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10",
  ringColor: "shadow-white/5",
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
  locale: string,
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
    return {
      label: locale === "zh" ? "高适配" : "Good Fit",
      color: "text-emerald-400 bg-emerald-500/10",
    };
  if (bad.some(([c, r]) => `${c},${r}` === key))
    return {
      label: locale === "zh" ? "低适配" : "Poor Fit",
      color: "text-red-400 bg-red-500/10",
    };
  return {
    label: locale === "zh" ? "中性" : "Neutral",
    color: "text-gray-400 bg-white/5",
  };
}

export default function StrategiesPage() {
  const { t, locale } = useI18n();
  const { theme } = useTheme();
  const isLight = theme === "light";
  const TPL_THEMES = isLight ? TPL_THEMES_LIGHT : TPL_THEMES_DARK;
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

  // Template name display helper (translate raw key to localized name)
  const templateNameDisplay = (rawName: string) => {
    if (locale !== "zh") return rawName;
    const tmpl = templates.find(
      (t) => t.name === rawName || t.name_zh === rawName,
    );
    return tmpl?.name_zh || rawName;
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
                  {matchResult.top_matches.map((m) => {
                    const tmpl = templates.find((t) => t.id === m.template_id);
                    const displayName =
                      locale === "zh" ? tmpl?.name_zh || m.name : m.name;
                    return (
                      <div
                        key={m.template_id}
                        className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3"
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-xs font-semibold text-white">
                            {displayName}
                          </span>
                          <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                            {m.score}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-400">
                          {locale === "zh" ? m.reason : m.reason_en}
                        </p>
                        <span className="mt-1 inline-block rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">
                          {locale === "zh" ? "AI推荐" : "AI Pick"}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {matchResult.excluded.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300">
                      {t("quant.aiMatch.excluded")} (
                      {matchResult.excluded.length})
                    </summary>
                    <div className="mt-2 space-y-1">
                      {matchResult.excluded.map((m) => {
                        const tmpl = templates.find(
                          (t) => t.id === m.template_id,
                        );
                        const displayName =
                          locale === "zh" ? tmpl?.name_zh || m.name : m.name;
                        return (
                          <div
                            key={m.template_id}
                            className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-1.5"
                          >
                            <span className="text-xs text-gray-400">
                              {displayName}
                            </span>
                            <span className="text-[10px] text-gray-600">
                              {locale === "zh" ? m.reason : m.reason_en}
                            </span>
                          </div>
                        );
                      })}
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
                  locale,
                );
                const isAiRecommended = matchResult?.top_matches.some(
                  (m) => m.template_id === tmpl.id,
                );
                const tplTheme =
                  TPL_THEMES[tmpl.name] ??
                  TPL_THEMES[tmpl.name_zh] ??
                  TPL_DEFAULT;
                return (
                  <div
                    key={tmpl.id}
                    className={`group relative overflow-hidden rounded-2xl border p-5 shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${tplTheme.card} ${tplTheme.hover} ${tplTheme.ringColor} ${
                      isAiRecommended ? "ring-2 ring-emerald-500/50" : ""
                    }`}
                  >
                    {/* Top accent bar */}
                    <div
                      className={`absolute inset-x-0 top-0 h-0.5 opacity-50 transition-opacity group-hover:opacity-100 ${tplTheme.accentBar}`}
                    />

                    {isAiRecommended && (
                      <div className="absolute -top-2 right-3 z-10">
                        <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[9px] font-bold text-white shadow-md">
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
                        <FlaskConical
                          className={`h-4 w-4 ${tplTheme.iconColor}`}
                        />
                      </div>
                    </div>
                    <h3
                      className={`mb-1.5 font-semibold ${
                        isLight ? "text-slate-900" : "text-white"
                      }`}
                    >
                      {locale === "zh" ? tmpl.name_zh : tmpl.name}
                    </h3>
                    <p
                      className={`mb-4 text-xs leading-relaxed ${
                        isLight ? "text-slate-600" : "text-gray-500"
                      }`}
                    >
                      {locale === "zh"
                        ? tmpl.description_zh || tmpl.description
                        : tmpl.description}
                    </p>
                    <Link
                      href="/dashboard/quant-lab"
                      className={`flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-colors ${tplTheme.buttonClass}`}
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
                            {templateNameDisplay(run.template_name)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-sm font-semibold text-cyan-400">
                              {run.symbol}
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
