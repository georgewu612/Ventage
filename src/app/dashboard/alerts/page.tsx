"use client";

import { useState } from "react";
import { Bell, Minus, TrendingDown, TrendingUp } from "lucide-react";

import { useAlertHistory } from "@/lib/hooks/useAlertHistory";
import { useI18n } from "@/lib/i18n/provider";

const MODULE_OPTIONS = [
  "",
  "options_flow",
  "insider_trades",
  "market_sentiment",
];
const DIRECTION_OPTIONS = ["", "bullish", "bearish", "neutral"];

function formatDate(dateStr: string, locale: string): string {
  try {
    return new Date(dateStr).toLocaleString(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export default function AlertsPage() {
  const { t, dateLocale } = useI18n();
  const [symbolFilter, setSymbolFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState("");

  const { alerts, total, loading, error } = useAlertHistory({
    symbol: symbolFilter || undefined,
    module: moduleFilter || undefined,
    direction: directionFilter || undefined,
    limit: 100,
  });

  const directionConfig: Record<
    string,
    { icon: typeof TrendingUp; color: string; bg: string; label: string }
  > = {
    bullish: {
      icon: TrendingUp,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      label: t("signal.bullish"),
    },
    bearish: {
      icon: TrendingDown,
      color: "text-red-400",
      bg: "bg-red-500/10",
      label: t("signal.bearish"),
    },
    neutral: {
      icon: Minus,
      color: "text-yellow-400",
      bg: "bg-yellow-500/10",
      label: t("signal.neutral"),
    },
  };

  return (
    <div>
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell className="h-7 w-7 text-cyan-400" />
              <div>
                <h1 className="text-3xl font-bold text-white">
                  {t("alertHistory.title")}
                </h1>
                <p className="mt-1 text-gray-400">
                  {t("alertHistory.subtitle")}
                </p>
              </div>
            </div>
            <div className="rounded-lg bg-white/10 px-4 py-2 backdrop-blur">
              <span className="font-medium text-white">{total}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Filters */}
        <div className="mb-8 grid grid-cols-1 gap-4 rounded-xl border border-white/10 bg-white/5 p-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t("filters.symbol")}
            </label>
            <input
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
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
                  {m || t("filters.all")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t("alerts.direction")}
            </label>
            <select
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value)}
              className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-white"
            >
              {DIRECTION_OPTIONS.map((d) => (
                <option key={d || "all"} value={d}>
                  {d ? t(`signal.${d}`) : t("filters.all")}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setSymbolFilter("");
                setModuleFilter("");
                setDirectionFilter("");
              }}
              className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white hover:bg-white/20"
            >
              {t("filters.reset")}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-300">
            {error.message}
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-xl border border-white/10 bg-white/5 p-5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-6 w-16 rounded bg-white/10" />
                    <div className="h-5 w-12 rounded bg-white/10" />
                  </div>
                  <div className="h-6 w-10 rounded bg-white/10" />
                </div>
              </div>
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <div className="mb-4 text-5xl opacity-40">🔔</div>
            <p className="text-lg text-gray-400">{t("alertHistory.empty")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => {
              const dc =
                directionConfig[alert.direction || "neutral"] ||
                directionConfig.neutral;
              const DirIcon = dc.icon;
              const scoreColor =
                (alert.signal_score ?? 0) >= 80
                  ? "text-emerald-400"
                  : (alert.signal_score ?? 0) >= 60
                    ? "text-yellow-400"
                    : "text-gray-300";

              return (
                <div
                  key={alert.id}
                  className="rounded-xl border border-white/10 bg-white/5 p-5 transition-colors hover:bg-white/[0.08]"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-bold text-white">
                        ${alert.symbol}
                      </span>
                      <div
                        className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${dc.bg} ${dc.color}`}
                      >
                        <DirIcon className="h-3.5 w-3.5" />
                        {dc.label}
                      </div>
                    </div>
                    <span
                      className={`text-2xl font-bold tabular-nums ${scoreColor}`}
                    >
                      {alert.signal_score ?? "-"}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-gray-400">
                      {alert.module}
                    </span>
                    <span>
                      {t("alertHistory.channel")}: {alert.channel || "telegram"}
                    </span>
                    <span>{formatDate(alert.sent_at, dateLocale)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
