"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BarChart2,
  ChevronRight,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { API_BASE_URL } from "@/lib/config";
import { FeatureGate } from "@/components/ui/FeatureGate";
import { useI18n } from "@/lib/i18n/provider";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Template {
  id: string;
  name: string;
  name_zh: string;
  description: string;
  category: string;
  default_params: Record<string, number>;
  params_schema: {
    properties: Record<
      string,
      {
        type: string;
        title: string;
        minimum: number;
        maximum: number;
      }
    >;
  };
}

interface Run {
  id: string;
  template_name: string;
  symbol: string;
  start_date: string;
  end_date: string;
  status: "pending" | "running" | "done" | "failed";
  created_at: string;
}

// ── Category config ───────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, { color: string; bg: string }> = {
  trend: { color: "text-cyan-400", bg: "bg-cyan-500/10" },
  mean_reversion: { color: "text-purple-400", bg: "bg-purple-500/10" },
  momentum: { color: "text-amber-400", bg: "bg-amber-500/10" },
  volatility: { color: "text-pink-400", bg: "bg-pink-500/10" },
};

const FACTOR_DEFS = [
  { key: "rsi_14", label: "RSI (14)", min: 0, max: 100, goodHigh: false },
  {
    key: "sma_20_50_cross",
    label: "SMA 20/50 Cross %",
    min: -15,
    max: 15,
    goodHigh: true,
  },
  {
    key: "price_momentum_20",
    label: "Momentum 20d %",
    min: -30,
    max: 30,
    goodHigh: true,
  },
  {
    key: "volatility_20",
    label: "Volatility 20d %",
    min: 0,
    max: 100,
    goodHigh: false,
  },
  { key: "bb_position", label: "BB Position", min: 0, max: 1, goodHigh: true },
  {
    key: "volume_ratio",
    label: "Volume Ratio",
    min: 0,
    max: 3,
    goodHigh: true,
  },
] as const;

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-500/20 text-gray-400",
  running: "bg-blue-500/20 text-blue-400",
  done: "bg-emerald-500/20 text-emerald-400",
  failed: "bg-red-500/20 text-red-400",
};

function StatusBadge({ status }: { status: Run["status"] }) {
  const { t } = useI18n();
  const cfg = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
  const label = {
    pending: t("quant.statusPending"),
    running: t("quant.statusRunning"),
    done: t("quant.statusDone"),
    failed: t("quant.statusFailed"),
  }[status];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg}`}
    >
      {label}
    </span>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function QuantLabPage() {
  const router = useRouter();
  const { t } = useI18n();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(
    null,
  );
  const [params, setParams] = useState<Record<string, number>>({});
  const [symbol, setSymbol] = useState("NVDA");
  const [startDate, setStartDate] = useState("2022-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    createSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (user) setUserId(user.id);
      });
    fetchTemplates();
  }, []);

  useEffect(() => {
    if (userId) fetchRuns();
  }, [userId]);

  async function fetchTemplates() {
    try {
      const r = await fetch(`${API_BASE_URL}/v1/strategies/templates`);
      if (r.ok) setTemplates(await r.json());
    } catch {}
  }

  async function fetchRuns() {
    if (!userId) return;
    try {
      const r = await fetch(
        `${API_BASE_URL}/v1/strategies/runs?user_id=${userId}&limit=20`,
      );
      if (r.ok) setRuns(await r.json());
    } catch {}
  }

  function openTemplate(t: Template) {
    setSelectedTemplate(t);
    setParams({ ...t.default_params });
    setRunError(null);
  }

  async function startBacktest() {
    if (!selectedTemplate || !userId) return;
    setRunning(true);
    setRunError(null);
    try {
      const r = await fetch(`${API_BASE_URL}/v1/strategies/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          template_name: selectedTemplate.name,
          template_id: selectedTemplate.id,
          symbol: symbol.toUpperCase(),
          start_date: startDate,
          end_date: endDate,
          params,
          engine: "vectorbt",
        }),
      });
      if (!r.ok)
        throw new Error((await r.json()).detail || "Backtest failed to start");
      setSelectedTemplate(null);
      setTimeout(fetchRuns, 1500);
      // Poll every 10s for 5 minutes
      let n = 0;
      const timer = setInterval(() => {
        fetchRuns();
        if (++n > 30) clearInterval(timer);
      }, 10_000);
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setRunning(false);
    }
  }

  function viewResult(run: Run) {
    router.push(`/dashboard/strategies/${run.id}`);
  }

  // ── Factor Scanner ────────────────────────────────────────────────
  const [factorSymbol, setFactorSymbol] = useState("NVDA");
  const [factorLoading, setFactorLoading] = useState(false);
  const [factorResult, setFactorResult] = useState<{
    symbol: string;
    last_price: number;
    last_date: string;
    factors: Record<string, number>;
  } | null>(null);
  const [factorError, setFactorError] = useState<string | null>(null);

  const runFactorScan = useCallback(async () => {
    if (!factorSymbol.trim()) return;
    setFactorLoading(true);
    setFactorError(null);
    setFactorResult(null);
    try {
      const r = await fetch(`${API_BASE_URL}/v1/factors/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: factorSymbol.trim().toUpperCase(),
          period: "1y",
        }),
      });
      if (!r.ok)
        throw new Error((await r.json()).detail ?? "Factor score failed");
      setFactorResult(await r.json());
    } catch (e: unknown) {
      setFactorError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setFactorLoading(false);
    }
  }, [factorSymbol, t]);

  return (
    <FeatureGate feature="quant_lab" overlay>
      <div className="min-h-screen bg-slate-900 p-6">
        <div className="mx-auto max-w-6xl">
          {/* Header */}
          <div className="mb-8 flex items-center gap-3">
            <div className="rounded-xl bg-amber-500/15 p-2.5">
              <FlaskConical className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Quant Lab</h1>
              <p className="text-sm text-gray-400">
                {t("quant.templates")} · Factor Research · {t("quant.run")}
              </p>
            </div>
            <button
              onClick={fetchRuns}
              className="ml-auto rounded-lg border border-white/10 p-2 text-gray-400 hover:bg-white/5"
              title={t("common.loading")}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {/* Templates */}
          <section className="mb-8">
            <h2 className="mb-4 text-xs font-semibold tracking-wider text-gray-500 uppercase">
              {t("quant.templates")}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {templates.map((tmpl) => {
                const catColors = CAT_COLORS[tmpl.category] ?? CAT_COLORS.trend;
                const catLabel =
                  {
                    trend: t("quant.catTrend"),
                    mean_reversion: t("quant.catMeanReversion"),
                    momentum: t("quant.catMomentum"),
                    volatility: t("quant.catVolatility"),
                  }[tmpl.category] ?? tmpl.category;
                return (
                  <div
                    key={tmpl.id}
                    onClick={() => openTemplate(tmpl)}
                    className="cursor-pointer rounded-2xl border border-white/10 bg-white/5 p-5 transition-all hover:border-white/20 hover:bg-white/[0.08]"
                  >
                    <div
                      className={`mb-3 inline-flex rounded-lg ${catColors.bg} px-2 py-1`}
                    >
                      <span
                        className={`text-[10px] font-semibold ${catColors.color}`}
                      >
                        {catLabel}
                      </span>
                    </div>
                    <h3 className="mb-1.5 font-semibold text-white">
                      {tmpl.name_zh}
                    </h3>
                    <p className="mb-4 text-xs leading-relaxed text-gray-500">
                      {tmpl.description}
                    </p>
                    <button className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/5 py-2 text-xs font-medium text-gray-300 hover:bg-white/10">
                      <Play className="h-3 w-3" /> {t("quant.run")}
                    </button>
                  </div>
                );
              })}
              {templates.length === 0 && (
                <div className="col-span-4 py-12 text-center text-sm text-gray-600">
                  {t("common.loading")}
                </div>
              )}
            </div>
          </section>

          {/* ── Factor Scanner ── */}
          <section className="mb-8">
            <h2 className="mb-4 text-xs font-semibold tracking-wider text-gray-500 uppercase">
              Factor Scanner
            </h2>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              {/* Input row */}
              <div className="mb-4 flex gap-3">
                <input
                  value={factorSymbol}
                  onChange={(e) =>
                    setFactorSymbol(e.target.value.toUpperCase())
                  }
                  onKeyDown={(e) => e.key === "Enter" && runFactorScan()}
                  placeholder="NVDA"
                  className="w-36 rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none"
                />
                <button
                  onClick={runFactorScan}
                  disabled={factorLoading}
                  className="flex items-center gap-2 rounded-lg bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
                >
                  {factorLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  Scan Factors
                </button>
                {factorResult && (
                  <span className="ml-auto self-center text-xs text-gray-500">
                    ${factorResult.symbol} · $
                    {factorResult.last_price.toFixed(2)} ·{" "}
                    {factorResult.last_date}
                  </span>
                )}
              </div>

              {factorError && (
                <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {factorError}
                </p>
              )}

              {/* Factor bars */}
              {factorResult && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {FACTOR_DEFS.map(({ key, label, min, max, goodHigh }) => {
                    const raw = factorResult.factors[key] ?? 0;
                    // clamp and normalise to 0-100%
                    const clamped = Math.max(min, Math.min(max, raw));
                    const pct = ((clamped - min) / (max - min)) * 100;
                    const isGood = goodHigh
                      ? raw > (min + max) / 2
                      : raw < (min + max) / 2;
                    const barColor = isGood ? "bg-emerald-500" : "bg-red-500";
                    const textColor = isGood
                      ? "text-emerald-400"
                      : "text-red-400";
                    return (
                      <div
                        key={key}
                        className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-400">
                            {label}
                          </span>
                          <span
                            className={`text-sm font-bold tabular-nums ${textColor}`}
                          >
                            {raw.toFixed(2)}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                          <div
                            className={`h-full transition-all duration-500 ${barColor}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="mt-1 flex justify-between text-[10px] text-gray-600">
                          <span>{min}</span>
                          <span>{max}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!factorResult && !factorLoading && !factorError && (
                <p className="py-6 text-center text-sm text-gray-600">
                  Enter a symbol and click Scan to see factor scores
                </p>
              )}
            </div>
          </section>

          {/* History */}
          <section>
            <h2 className="mb-4 text-xs font-semibold tracking-wider text-gray-500 uppercase">
              {t("quant.runHistory")}
            </h2>
            {runs.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 py-16 text-center">
                <BarChart2 className="mx-auto mb-3 h-8 w-8 text-gray-700" />
                <p className="text-sm text-gray-500">{t("common.noData")}</p>
                <p className="mt-1 text-xs text-gray-600">
                  {t("quant.newBacktest")}
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {[
                        t("quant.templates"),
                        t("quant.symbol"),
                        t("quant.startDate"),
                        t("common.status"),
                        t("quant.detail.date"),
                        "",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-semibold text-gray-500"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {runs.map((run) => (
                      <tr key={run.id} className="hover:bg-white/[0.03]">
                        <td className="px-4 py-3 text-sm text-gray-300">
                          {run.template_name}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm font-semibold text-cyan-400">
                          {run.symbol}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {run.start_date} → {run.end_date}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={run.status} />
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {new Date(run.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {run.status === "done" && (
                            <button
                              onClick={() => viewResult(run)}
                              className="flex items-center gap-1 rounded-lg bg-cyan-500/10 px-3 py-1 text-xs text-cyan-400 hover:bg-cyan-500/20"
                            >
                              <ChevronRight className="h-3 w-3" />
                              {t("quant.viewResult")}
                            </button>
                          )}
                          {run.status === "running" && (
                            <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Backtest Config Modal */}
      {selectedTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-5">
              <div>
                <h2 className="font-bold text-white">
                  {selectedTemplate.name_zh}
                </h2>
                <p className="text-xs text-gray-500">
                  {selectedTemplate.description}
                </p>
              </div>
              <button
                onClick={() => setSelectedTemplate(null)}
                className="text-gray-500 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-400">
                    {t("quant.symbol")}
                  </label>
                  <input
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
                    placeholder="NVDA"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-400">
                    {t("quant.startDate")}
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-400">
                    {t("quant.endDate")}
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold tracking-wider text-gray-500 uppercase">
                  {t("quant.detail.params")}
                </label>
                <div className="space-y-3">
                  {Object.entries(
                    selectedTemplate.params_schema?.properties ?? {},
                  ).map(([key, schema]) => (
                    <div key={key}>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="text-xs text-gray-400">
                          {schema.title}
                        </label>
                        <span className="text-xs font-semibold text-cyan-400">
                          {params[key] ?? selectedTemplate.default_params[key]}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={schema.minimum}
                        max={schema.maximum}
                        step={schema.type === "integer" ? 1 : 0.1}
                        value={
                          params[key] ?? selectedTemplate.default_params[key]
                        }
                        onChange={(e) =>
                          setParams((p) => ({
                            ...p,
                            [key]:
                              schema.type === "integer"
                                ? parseInt(e.target.value)
                                : parseFloat(e.target.value),
                          }))
                        }
                        className="w-full accent-cyan-500"
                      />
                      <div className="flex justify-between text-[10px] text-gray-600">
                        <span>{schema.minimum}</span>
                        <span>{schema.maximum}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {runError && (
                <p className="rounded-lg bg-red-500/10 p-3 text-xs text-red-400">
                  {runError}
                </p>
              )}
            </div>
            <div className="border-t border-white/10 p-5">
              <button
                onClick={startBacktest}
                disabled={running}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-3 text-sm font-semibold text-white hover:bg-cyan-400 disabled:opacity-50"
              >
                {running ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />{" "}
                    {t("common.loading")}
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" /> {t("quant.newBacktest")}
                  </>
                )}
              </button>
              <p className="mt-2 text-center text-[10px] text-gray-600">
                {t("quant.runHistory")}
              </p>
            </div>
          </div>
        </div>
      )}
    </FeatureGate>
  );
}
