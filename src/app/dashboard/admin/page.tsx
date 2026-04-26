"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Database,
  Play,
  RefreshCw,
} from "lucide-react";

import { useSystemStatus } from "@/lib/hooks/useSystemStatus";
import { useI18n } from "@/lib/i18n/provider";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://faithful-simplicity-production-3a01.up.railway.app";

export default function AdminPage() {
  const { status, loading } = useSystemStatus();
  const { t, dateLocale } = useI18n();
  const [triggerStates, setTriggerStates] = useState<
    Record<string, "idle" | "loading" | "ok" | "error">
  >({});

  async function triggerAction(label: string, url: string, method = "POST") {
    setTriggerStates((s) => ({ ...s, [label]: "loading" }));
    try {
      const res = await fetch(`${API_BASE}${url}`, { method });
      setTriggerStates((s) => ({ ...s, [label]: res.ok ? "ok" : "error" }));
    } catch {
      setTriggerStates((s) => ({ ...s, [label]: "error" }));
    }
    setTimeout(
      () => setTriggerStates((s) => ({ ...s, [label]: "idle" })),
      3000,
    );
  }

  return (
    <div>
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <h1 className="text-3xl font-bold text-white">系统管理</h1>
          <p className="mt-1 text-gray-400">
            ETL 采集器状态 · 数据表健康度 · 系统监控
          </p>
        </div>
      </header>

      <main className="container mx-auto space-y-6 px-6 py-8">
        {loading ? (
          <div className="flex items-center gap-2 text-gray-400">
            <Clock className="h-4 w-4 animate-spin" />
            加载中...
          </div>
        ) : !status ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-400">
            无法获取系统状态，请确认后端服务正常运行。
          </div>
        ) : (
          <>
            {/* Overview */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="mb-1 text-xs text-gray-400">
                  {t("common.status")}
                </p>
                <div className="flex items-center gap-2">
                  {status.status === "ok" ? (
                    <CheckCircle className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-yellow-400" />
                  )}
                  <span
                    className={`font-semibold ${status.status === "ok" ? "text-emerald-400" : "text-yellow-400"}`}
                  >
                    {status.status === "ok"
                      ? t("system.ok")
                      : t("system.degraded")}
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="mb-1 text-xs text-gray-400">
                  {t("system.tablesHealthy")}
                </p>
                <p className="text-2xl font-bold text-white">
                  {status.healthy_tables ?? 0}
                  <span className="text-sm text-gray-500">
                    /{status.total_tables ?? 0}
                  </span>
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 md:col-span-2">
                <p className="mb-1 text-xs text-gray-400">
                  {t("system.lastCheck")}
                </p>
                <p className="font-medium text-white">
                  {status.checked_at
                    ? new Date(status.checked_at).toLocaleString(dateLocale)
                    : "—"}
                </p>
              </div>
            </div>

            {/* Collector Status */}
            {(status.collectors ?? []).length > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <h2 className="mb-4 font-semibold text-white">
                  {t("system.collectors")}
                </h2>
                <div className="space-y-3">
                  {status.collectors.map((c) => {
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
                        className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-lg">{icon}</span>
                          <div>
                            <p className="text-sm font-medium text-white">
                              {t(
                                `module.${c.job}` as Parameters<typeof t>[0],
                              ) || c.job}
                            </p>
                            <p className="text-xs text-gray-500">{c.job}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p
                            className={`text-sm font-medium ${
                              c.status === "success"
                                ? "text-emerald-400"
                                : c.status === "error"
                                  ? "text-red-400"
                                  : "text-yellow-400"
                            }`}
                          >
                            {c.status ?? "unknown"}
                          </p>
                          <p className="text-xs text-gray-500">
                            {lagMin != null
                              ? `${lagMin}${t("system.minutesAgo")}`
                              : t("system.never")}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Table Health */}
            {(status.tables ?? []).length > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <Database className="h-4 w-4 text-gray-400" />
                  <h2 className="font-semibold text-white">数据表状态</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-left text-xs text-gray-500">
                        <th className="pb-2 font-medium">数据表</th>
                        <th className="pb-2 font-medium">总记录</th>
                        <th className="pb-2 font-medium">
                          {t("system.dataLag")} (秒)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {status.tables.map((table) => (
                        <tr key={table.table}>
                          <td className="py-2.5 text-gray-300">
                            {t(
                              `module.${table.table}` as Parameters<
                                typeof t
                              >[0],
                            ) || table.table}
                            <span className="ml-2 text-xs text-gray-600">
                              ({table.table})
                            </span>
                          </td>
                          <td className="py-2.5 font-mono text-white">
                            {table.total?.toLocaleString() ?? "—"}
                          </td>
                          <td className="py-2.5 font-mono">
                            <span
                              className={
                                (table.lag_seconds ?? 0) < 3600
                                  ? "text-emerald-400"
                                  : "text-yellow-400"
                              }
                            >
                              {table.lag_seconds ?? "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {/* Manual Triggers */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <h2 className="mb-4 flex items-center gap-2 font-semibold text-white">
                <Play className="h-4 w-4 text-cyan-400" />
                手动触发
              </h2>
              <div className="flex flex-wrap gap-3">
                {[
                  { label: "刷新 Regime", url: "/v1/market/regime/refresh" },
                  { label: "刷新信号", url: "/v1/system/signals/refresh" },
                  {
                    label: "生成组合快照",
                    url: "/v1/portfolio/snapshot?user_id=system",
                  },
                ].map(({ label, url }) => {
                  const state = triggerStates[label] ?? "idle";
                  return (
                    <button
                      key={label}
                      onClick={() => triggerAction(label, url)}
                      disabled={state === "loading"}
                      className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-all disabled:opacity-50 ${
                        state === "ok"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : state === "error"
                            ? "border-red-500/30 bg-red-500/10 text-red-300"
                            : "border-white/10 bg-white/5 text-gray-300 hover:bg-white/10"
                      }`}
                    >
                      {state === "loading" ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : state === "ok" ? (
                        <CheckCircle className="h-3.5 w-3.5" />
                      ) : state === "error" ? (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
