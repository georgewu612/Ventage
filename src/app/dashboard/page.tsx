"use client";

import { useCallback, useMemo, useState } from "react";

import {
  SignalCard,
  SignalCardSkeleton,
} from "@/components/dashboard/SignalCard";
import { SignalDetail } from "@/components/dashboard/SignalDetail";
import { SlidePanel } from "@/components/ui/SlidePanel";
import { ToastContainer, ToastItem } from "@/components/ui/Toast";
import { useAlertsPreview } from "@/lib/hooks/useAlertsPreview";
import { useMarketSignals } from "@/lib/hooks/useMarketSignals";
import { useSystemStatus } from "@/lib/hooks/useSystemStatus";
import { useI18n } from "@/lib/i18n/provider";

const MODULE_OPTIONS = [
  "",
  "options_flow",
  "insider_trades",
  "market_sentiment",
  "dark_pool",
];

function PutCallGauge({ ratio }: { ratio: number | null | undefined }) {
  const { t } = useI18n();
  if (ratio == null) {
    return (
      <span className="text-2xl font-semibold text-gray-400">
        {t("summary.putCallNA")}
      </span>
    );
  }
  const color =
    ratio > 1.2
      ? "text-red-400"
      : ratio < 0.8
        ? "text-green-400"
        : "text-cyan-300";
  return <span className={`text-2xl font-semibold ${color}`}>{ratio}</span>;
}

export default function DashboardPage() {
  const { t, dateLocale } = useI18n();

  const [symbolInput, setSymbolInput] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [minScore, setMinScore] = useState(20);

  const [selectedSignal, setSelectedSignal] = useState<
    (typeof signals)[number] | null
  >(null);

  const [alertMinScore, setAlertMinScore] = useState(75);
  const [alertModule, setAlertModule] = useState("");
  const [alertDirection, setAlertDirection] = useState("bullish,bearish");
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleNewSignals = useCallback((count: number) => {
    const id = `toast-${Date.now()}`;
    setToasts((prev) => [
      ...prev,
      {
        id,
        message: `🆕 ${count} 条新信号到达`,
        type: "success",
      },
    ]);
  }, []);

  const filters = useMemo(
    () => ({
      symbol: symbolInput.trim() || undefined,
      module: moduleFilter || undefined,
      minScore,
      limit: 30,
      offset: 0,
    }),
    [symbolInput, moduleFilter, minScore],
  );

  const { signals, summary, total, loading, error } = useMarketSignals({
    ...filters,
    onNewSignals: handleNewSignals,
  });
  const { status } = useSystemStatus();
  const {
    data: alertPreview,
    loading: alertLoading,
    error: alertError,
    preview,
  } = useAlertsPreview();

  if (error) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <div className="text-4xl">⚠️</div>
        <div className="text-xl text-red-400">{error.message}</div>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  const moduleEntries = Object.entries(summary?.by_module ?? {}).sort(
    (a, b) => b[1] - a[1],
  );
  const maxModuleCount = moduleEntries.length
    ? Math.max(...moduleEntries.map(([, count]) => count))
    : 1;

  const bullish = summary?.bullish ?? 0;
  const bearish = summary?.bearish ?? 0;
  const neutral = summary?.neutral ?? 0;
  const totalDir = bullish + bearish + neutral || 1;
  const bullPct = Math.round((bullish / totalDir) * 100);
  const bearPct = Math.round((bearish / totalDir) * 100);
  const neutPct = 100 - bullPct - bearPct;

  const topSymbols = summary?.top_symbols ?? [];
  const maxSymbolCount = topSymbols.length
    ? Math.max(...topSymbols.map((s) => s.count))
    : 1;

  return (
    <div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">
                {t("dashboard.title")}
              </h1>
              <p className="mt-1 text-gray-400">{t("dashboard.subtitle")}</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="rounded-lg bg-white/10 px-4 py-2 backdrop-blur">
                <span className="font-medium text-white">
                  {total} {t("common.signals")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* ── Summary Cards ── */}
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-5">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-gray-400">{t("summary.total24h")}</p>
            <p className="text-2xl font-semibold text-white">
              {summary?.total_signals ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-4">
            <p className="text-sm text-green-300">{t("summary.bullish")}</p>
            <p className="text-2xl font-semibold text-white">{bullish}</p>
          </div>
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
            <p className="text-sm text-red-300">{t("summary.bearish")}</p>
            <p className="text-2xl font-semibold text-white">{bearish}</p>
          </div>
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-4">
            <p className="text-sm text-cyan-300">{t("summary.avgScore")}</p>
            <p className="text-2xl font-semibold text-white">
              {summary?.average_score ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/10 p-4">
            <p className="text-sm text-purple-300">
              {t("summary.putCallRatio")}
            </p>
            <PutCallGauge ratio={summary?.put_call_ratio} />
          </div>
        </div>

        {/* ── Analytics Row ── */}
        <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* Top Symbols */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-3 font-semibold text-white">
              {t("chart.topSymbols")}
            </h3>
            {topSymbols.length === 0 ? (
              <p className="text-sm text-gray-400">N/A</p>
            ) : (
              <div className="space-y-3">
                {topSymbols.map(({ symbol, count }, i) => {
                  const width = Math.max(
                    8,
                    Math.round((count / maxSymbolCount) * 100),
                  );
                  const medal = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"][i] ?? "";
                  return (
                    <div key={symbol}>
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-300">
                        <span>
                          {medal}{" "}
                          <span className="font-bold text-white">
                            ${symbol}
                          </span>
                        </span>
                        <span>
                          {count} {t("chart.signals")}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded bg-slate-700/80">
                        <div
                          className="h-full bg-cyan-400"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Direction Distribution */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-3 font-semibold text-white">
              {t("chart.directionDist")}
            </h3>
            {summary?.total_signals === 0 ? (
              <p className="text-sm text-gray-400">N/A</p>
            ) : (
              <div className="space-y-4">
                {/* Stacked bar */}
                <div className="flex h-6 overflow-hidden rounded-full">
                  {bullPct > 0 && (
                    <div
                      className="flex items-center justify-center bg-green-500 text-[10px] font-bold text-white"
                      style={{ width: `${bullPct}%` }}
                      title={`${t("chart.bullish")} ${bullPct}%`}
                    >
                      {bullPct >= 12 ? `${bullPct}%` : ""}
                    </div>
                  )}
                  {neutPct > 0 && (
                    <div
                      className="flex items-center justify-center bg-yellow-500/70 text-[10px] font-bold text-white"
                      style={{ width: `${neutPct}%` }}
                      title={`${t("chart.neutral")} ${neutPct}%`}
                    >
                      {neutPct >= 12 ? `${neutPct}%` : ""}
                    </div>
                  )}
                  {bearPct > 0 && (
                    <div
                      className="flex items-center justify-center bg-red-500 text-[10px] font-bold text-white"
                      style={{ width: `${bearPct}%` }}
                      title={`${t("chart.bearish")} ${bearPct}%`}
                    >
                      {bearPct >= 12 ? `${bearPct}%` : ""}
                    </div>
                  )}
                </div>

                {/* Legend rows */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-sm bg-green-500" />
                      <span className="text-green-300">
                        {t("chart.bullish")}
                      </span>
                    </div>
                    <span className="text-white">
                      {bullish}{" "}
                      <span className="text-gray-400">({bullPct}%)</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-sm bg-yellow-500/70" />
                      <span className="text-yellow-300">
                        {t("chart.neutral")}
                      </span>
                    </div>
                    <span className="text-white">
                      {neutral}{" "}
                      <span className="text-gray-400">({neutPct}%)</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-sm bg-red-500" />
                      <span className="text-red-300">{t("chart.bearish")}</span>
                    </div>
                    <span className="text-white">
                      {bearish}{" "}
                      <span className="text-gray-400">({bearPct}%)</span>
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Module Distribution */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-3 font-semibold text-white">
              {t("chart.moduleDist")}
            </h3>
            {moduleEntries.length === 0 ? (
              <p className="text-sm text-gray-400">N/A</p>
            ) : (
              <div className="space-y-3">
                {moduleEntries.map(([module, count]) => {
                  const width = Math.max(
                    8,
                    Math.round((count / maxModuleCount) * 100),
                  );
                  return (
                    <div key={module}>
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-300">
                        <span>{module}</span>
                        <span>{count}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded bg-slate-700/80">
                        <div
                          className="h-full bg-cyan-400"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── System Status + Alerts Preview ── */}
        <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
          {/* System Status */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-3 font-semibold text-white">
              {t("system.title")}
            </h3>
            <div className="mb-3 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-400">{t("common.status")}</p>
                <p
                  className={`font-semibold ${status?.status === "ok" ? "text-green-300" : "text-yellow-300"}`}
                >
                  {status?.status === "ok"
                    ? t("system.ok")
                    : t("system.degraded")}
                </p>
              </div>
              <div>
                <p className="text-gray-400">{t("system.tablesHealthy")}</p>
                <p className="font-semibold text-white">
                  {status?.healthy_tables ?? 0}/{status?.total_tables ?? 0}
                </p>
              </div>
            </div>
            {status?.checked_at && (
              <p className="mb-3 text-xs text-gray-500">
                {t("system.lastCheck")}:{" "}
                {new Date(status.checked_at).toLocaleString(dateLocale)}
              </p>
            )}

            {/* Collector job run history */}
            {(status?.collectors ?? []).length > 0 && (
              <div className="mb-3">
                <p className="mb-2 text-xs font-medium text-gray-400">
                  {t("system.collectors")}
                </p>
                <div className="space-y-1.5">
                  {(status?.collectors ?? []).map((c) => {
                    const icon =
                      c.status === "success"
                        ? "✅"
                        : c.status === "error"
                          ? "❌"
                          : "⏳";
                    const lagMin =
                      c.lag_seconds != null
                        ? Math.round(c.lag_seconds / 60)
                        : null;
                    return (
                      <div
                        key={c.job}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-gray-400">
                          {icon}{" "}
                          {c.job.replace("_collector", "").replace("_", " ")}
                        </span>
                        <span className="text-gray-500">
                          {lagMin != null
                            ? `${lagMin}m ago`
                            : t("system.never")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {(status?.tables ?? []).map((table) => (
                <div
                  key={table.table}
                  className="flex items-center justify-between border-t border-white/5 pt-2 text-xs text-gray-300"
                >
                  <span>{table.table}</span>
                  <span>
                    {table.total} | {t("system.dataLag")}:{" "}
                    {table.lag_seconds ?? "-"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Alerts Preview */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-3 font-semibold text-white">
              {t("alerts.previewTitle")}
            </h3>
            <div className="mb-3 grid grid-cols-1 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-400">
                  {t("alerts.minScore")}
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={alertMinScore}
                  onChange={(e) =>
                    setAlertMinScore(Number(e.target.value) || 0)
                  }
                  className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">
                  {t("alerts.direction")}
                </label>
                <select
                  value={alertDirection}
                  onChange={(e) => setAlertDirection(e.target.value)}
                  className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-white"
                >
                  <option value="bullish,bearish">bullish + bearish</option>
                  <option value="bullish">bullish only</option>
                  <option value="bearish">bearish only</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">
                  {t("alerts.module")}
                </label>
                <select
                  value={alertModule}
                  onChange={(e) => setAlertModule(e.target.value)}
                  className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-white"
                >
                  {MODULE_OPTIONS.map((m) => (
                    <option key={m || "all"} value={m}>
                      {m || t("filters.all")}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={() =>
                preview({
                  min_score: alertMinScore,
                  directions: alertDirection.split(",").filter(Boolean),
                  modules: alertModule ? [alertModule] : [],
                  limit: 5,
                })
              }
              disabled={alertLoading}
              className="w-full rounded bg-cyan-600 px-3 py-2 text-sm text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {alertLoading ? t("common.loading") : t("alerts.runPreview")}
            </button>

            {alertError && (
              <p className="mt-3 text-xs text-red-400">{alertError.message}</p>
            )}
            <p className="mt-2 text-[11px] text-gray-500">
              {t("alerts.previewOnly")}
            </p>

            {alertPreview && (
              <div className="mt-3 max-h-56 space-y-2 overflow-auto pr-1">
                <p className="text-xs text-gray-400">
                  {t("alerts.candidates")}: {alertPreview.total_candidates}
                </p>
                {alertPreview.candidates.map((c) => (
                  <div
                    key={c.id}
                    className="rounded border border-white/10 p-2"
                  >
                    <div className="flex items-center justify-between text-xs text-white">
                      <span>{c.symbol}</span>
                      <span>{c.signal_score}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-gray-300">
                      {c.summary}
                    </p>
                    <p className="mt-1 text-[10px] text-gray-500">
                      {c.module} · {c.signal_type}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Signal Filters ── */}
        <div className="mb-8 grid grid-cols-1 gap-4 rounded-xl border border-white/10 bg-white/5 p-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t("filters.symbol")}
            </label>
            <input
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              placeholder="AAPL"
              className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t("filters.module")}
            </label>
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-white"
            >
              {MODULE_OPTIONS.map((m) => (
                <option key={m || "all"} value={m}>
                  {m ? m : t("filters.all")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t("filters.minScore")}
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value) || 0)}
              className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-white"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setSymbolInput("");
                setModuleFilter("");
                setMinScore(20);
              }}
              className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white hover:bg-white/20"
            >
              {t("filters.reset")}
            </button>
          </div>
        </div>

        {/* ── Signal List ── */}
        <div className="mb-8">
          <h2 className="mb-2 text-2xl font-bold text-white">
            {t("dashboard.sectionTitle")}
          </h2>
          <p className="text-gray-400">{t("dashboard.subtitle")}</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SignalCardSkeleton key={i} />
            ))}
          </div>
        ) : signals.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <div className="mb-4 text-5xl opacity-40">📭</div>
            <p className="text-lg text-gray-400">{t("dashboard.empty")}</p>
            <p className="mt-2 text-sm text-gray-500">
              {t("dashboard.emptyHint")}
            </p>
          </div>
        ) : (
          <div className="animate-stagger grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {signals.map((signal) => (
              <div key={signal.id} className="animate-slide-up">
                <SignalCard
                  signal={signal}
                  onClick={() => setSelectedSignal(signal)}
                />
              </div>
            ))}
          </div>
        )}
      </main>

      <SlidePanel
        isOpen={!!selectedSignal}
        onClose={() => setSelectedSignal(null)}
        title={t("detail.title")}
      >
        {selectedSignal && <SignalDetail signal={selectedSignal} />}
      </SlidePanel>

      <footer className="mt-20 border-t border-white/10 bg-white/5 py-8 backdrop-blur-sm">
        <div className="container mx-auto px-6 text-center text-gray-500">
          <p>{t("footer.text")}</p>
        </div>
      </footer>
    </div>
  );
}
