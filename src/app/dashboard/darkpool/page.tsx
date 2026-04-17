"use client";

import { useState } from "react";
import { Layers } from "lucide-react";

import { useDarkPool } from "@/lib/hooks/useDarkPool";
import { useI18n } from "@/lib/i18n/provider";

function formatValue(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function formatSize(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

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

function valueColor(v: number | null): string {
  if (v == null) return "text-gray-400";
  if (v >= 10_000_000) return "text-purple-400";
  if (v >= 5_000_000) return "text-cyan-400";
  if (v >= 1_000_000) return "text-emerald-400";
  return "text-gray-300";
}

export default function DarkPoolPage() {
  const { t, dateLocale } = useI18n();
  const [symbolFilter, setSymbolFilter] = useState("");
  const [exchangeFilter, setExchangeFilter] = useState("");
  const [minValueM, setMinValueM] = useState("");

  const minValue =
    minValueM !== "" ? parseFloat(minValueM) * 1_000_000 : undefined;

  const { orders, total, loading, error } = useDarkPool({
    symbol: symbolFilter || undefined,
    exchange: exchangeFilter || undefined,
    minValue,
    limit: 100,
  });

  return (
    <div>
      {/* Header */}
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Layers className="h-7 w-7 text-purple-400" />
              <div>
                <h1 className="text-3xl font-bold text-white">
                  {t("darkpool.title")}
                </h1>
                <p className="mt-1 text-gray-400">{t("darkpool.subtitle")}</p>
              </div>
            </div>
            <div className="rounded-lg bg-white/10 px-4 py-2 backdrop-blur">
              <span className="font-medium text-white">{total}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto space-y-6 px-6 py-8">
        {/* Info banner */}
        <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-3 text-sm text-purple-300">
          🌑
          暗池交易由机构在交易所外执行，方向性模糊但大额成交往往预示机构布局。
          数据来源：Unusual Whales / FINRA OTC Transparency（15分钟~每周延迟）
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/10 bg-white/5 p-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t("filters.symbol")}
            </label>
            <input
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
              placeholder="NVDA"
              className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t("darkpool.filterExchange")}
            </label>
            <input
              value={exchangeFilter}
              onChange={(e) => setExchangeFilter(e.target.value.toUpperCase())}
              placeholder="DARK / FINRA_OTC"
              className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t("darkpool.minValue")} ($M)
            </label>
            <input
              value={minValueM}
              onChange={(e) => setMinValueM(e.target.value)}
              placeholder="1 = $1M"
              type="number"
              min="0"
              step="0.5"
              className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-white"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setSymbolFilter("");
                setExchangeFilter("");
                setMinValueM("");
              }}
              className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white hover:bg-white/20"
            >
              {t("filters.reset")}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-300">
            {error.message}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="h-5 w-20 rounded bg-white/10" />
                  <div className="h-5 w-24 rounded bg-white/10" />
                </div>
              </div>
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <div className="mb-4 text-5xl opacity-40">🌑</div>
            <p className="text-lg text-gray-400">{t("darkpool.empty")}</p>
            <p className="mt-2 text-sm text-gray-600">
              数据将在采集器下次运行后出现（每30分钟）
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5 text-left text-xs tracking-wide text-gray-400 uppercase">
                  <th className="px-4 py-3">{t("filters.symbol")}</th>
                  <th className="px-4 py-3">{t("darkpool.value")}</th>
                  <th className="px-4 py-3">{t("darkpool.size")}</th>
                  <th className="px-4 py-3">{t("darkpool.price")}</th>
                  <th className="px-4 py-3">{t("darkpool.exchange")}</th>
                  <th className="px-4 py-3">{t("darkpool.tradeTime")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-b border-white/5 transition-colors hover:bg-white/[0.04]"
                  >
                    <td className="px-4 py-3 font-bold text-white">
                      ${order.symbol}
                    </td>
                    <td
                      className={`px-4 py-3 font-semibold tabular-nums ${valueColor(order.value)}`}
                    >
                      {formatValue(order.value)}
                    </td>
                    <td className="px-4 py-3 text-gray-300 tabular-nums">
                      {formatSize(order.size)}
                    </td>
                    <td className="px-4 py-3 text-gray-300 tabular-nums">
                      {order.price > 0 ? `$${order.price.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-xs text-purple-300">
                        {order.exchange || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatDate(order.trade_time, dateLocale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
