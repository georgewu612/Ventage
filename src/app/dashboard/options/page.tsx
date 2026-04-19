"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ArrowDown, ArrowUp, Filter } from "lucide-react";

import { useOptionsFlow } from "@/lib/hooks/useOptionsFlow";
import { useI18n } from "@/lib/i18n/provider";

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(2)}`;
}

function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

function OptionCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-6 w-16 rounded bg-white/10" />
          <div className="h-6 w-14 rounded-full bg-white/10" />
        </div>
        <div className="h-5 w-24 rounded bg-white/10" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <div className="mb-1 h-3 w-12 rounded bg-white/10" />
            <div className="h-5 w-16 rounded bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}

function OptionsInner() {
  const searchParams = useSearchParams();
  const { options, loading, error } = useOptionsFlow(50);
  const { t, dateLocale } = useI18n();
  const [typeFilter, setTypeFilter] = useState<"" | "call" | "put">("");
  const [symbolFilter, setSymbolFilter] = useState(
    (searchParams.get("symbol") ?? "").toUpperCase(),
  );

  const filtered = options.filter((o) => {
    if (typeFilter && o.option_type !== typeFilter) return false;
    if (symbolFilter && !o.symbol.includes(symbolFilter.toUpperCase()))
      return false;
    return true;
  });

  // Symbol-level summary (based on unfiltered data)
  const symbolGroups = Object.values(
    options.reduce<
      Record<
        string,
        {
          symbol: string;
          calls: number;
          puts: number;
          callPremium: number;
          putPremium: number;
          totalVolume: number;
        }
      >
    >((acc, o) => {
      if (!acc[o.symbol]) {
        acc[o.symbol] = {
          symbol: o.symbol,
          calls: 0,
          puts: 0,
          callPremium: 0,
          putPremium: 0,
          totalVolume: 0,
        };
      }
      const g = acc[o.symbol];
      if (o.option_type === "call") {
        g.calls++;
        g.callPremium += o.premium ?? 0;
      } else {
        g.puts++;
        g.putPremium += o.premium ?? 0;
      }
      g.totalVolume += o.volume ?? 0;
      return acc;
    }, {}),
  ).sort((a, b) => b.calls + b.puts - (a.calls + a.puts));

  return (
    <div>
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">
                {t("nav.options")}
              </h1>
              <p className="mt-1 text-gray-400">{t("options.subtitle")}</p>
            </div>
            <div className="rounded-lg bg-white/10 px-4 py-2 backdrop-blur">
              <span className="font-medium text-white">
                {filtered.length} / {options.length}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Symbol Summary Strip */}
        {symbolGroups.length > 0 && (
          <div className="mb-6">
            <p className="mb-2 text-xs font-medium tracking-wider text-gray-500 uppercase">
              {t("summary.bySymbol")}
            </p>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {symbolGroups.map((g) => {
                const totalPremium = g.callPremium + g.putPremium;
                // P/C by premium (more meaningful than by count for flow analysis)
                const pcRatio =
                  g.callPremium > 0
                    ? (g.putPremium / g.callPremium).toFixed(2)
                    : "∞";
                const isBullish = g.callPremium >= g.putPremium;
                const isActive = symbolFilter === g.symbol;
                return (
                  <button
                    key={g.symbol}
                    onClick={() => setSymbolFilter(isActive ? "" : g.symbol)}
                    className={`flex min-w-[148px] flex-col rounded-xl border p-3 text-left transition-all ${
                      isActive
                        ? "border-cyan-500/60 bg-cyan-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.08]"
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-bold text-white">${g.symbol}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          isBullish
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-red-500/15 text-red-400"
                        }`}
                      >
                        {isBullish ? "↑ CALL" : "↓ PUT"}
                      </span>
                    </div>
                    <div className="flex gap-3 text-xs">
                      <span className="text-emerald-400">
                        C {g.calls}{" "}
                        <span className="text-emerald-300">
                          {formatCurrency(g.callPremium)}
                        </span>
                      </span>
                      <span className="text-red-400">
                        P {g.puts}{" "}
                        <span className="text-red-300">
                          {formatCurrency(g.putPremium)}
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      C+P {formatCurrency(totalPremium)}
                      <span className="ml-2" title="按权利金计算">
                        P/C$ {pcRatio}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Filter className="h-4 w-4 text-gray-400" />
          <input
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
            placeholder="Symbol..."
            className="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-gray-500"
          />
          <div className="flex rounded-lg border border-white/10">
            {(["", "call", "put"] as const).map((type) => (
              <button
                key={type || "all"}
                onClick={() => setTypeFilter(type)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  typeFilter === type
                    ? "bg-white/15 text-white"
                    : "text-gray-400 hover:text-white"
                } ${type === "" ? "rounded-l-lg" : ""} ${type === "put" ? "rounded-r-lg" : ""}`}
              >
                {type === "" ? "All" : type.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="flex flex-col items-center py-20">
            <div className="mb-4 text-4xl">⚠️</div>
            <div className="text-red-400">{error.message}</div>
          </div>
        ) : loading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <OptionCardSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-20">
            <div className="mb-4 text-5xl opacity-40">📭</div>
            <p className="text-lg text-gray-400">{t("options.empty")}</p>
          </div>
        ) : (
          <div className="animate-stagger space-y-3">
            {filtered.map((option) => {
              const isCall = option.option_type === "call";
              const dte = daysUntil(option.expiration);
              const scoreColor =
                (option.unusual_score ?? 0) >= 70
                  ? "text-red-400"
                  : (option.unusual_score ?? 0) >= 40
                    ? "text-yellow-400"
                    : "text-gray-400";

              return (
                <div
                  key={option.id}
                  className="animate-fade-in rounded-xl border border-white/10 bg-white/5 p-5 transition-all duration-200 hover:bg-white/[0.08]"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-bold text-white">
                        ${option.symbol}
                      </span>
                      <div
                        className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          isCall
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-red-500/15 text-red-400"
                        }`}
                      >
                        {isCall ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )}
                        {option.option_type.toUpperCase()}
                      </div>
                      {option.trade_type && (
                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-gray-400">
                          {option.trade_type}
                        </span>
                      )}
                    </div>
                    {option.unusual_score != null && (
                      <div
                        className={`text-lg font-bold tabular-nums ${scoreColor}`}
                      >
                        {option.unusual_score.toFixed(0)}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-5">
                    <div>
                      <p className="text-xs text-gray-500">Strike</p>
                      <p className="font-medium text-white">
                        ${option.strike.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Expiration</p>
                      <p className="font-medium text-white">
                        {new Date(option.expiration).toLocaleDateString(
                          dateLocale,
                        )}
                        <span className="ml-1 text-xs text-gray-500">
                          ({dte}d)
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Premium</p>
                      <p className="font-medium text-white">
                        {formatCurrency(option.premium)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Volume</p>
                      <p className="font-medium text-white">
                        {option.volume.toLocaleString()}
                      </p>
                    </div>
                    {option.implied_volatility != null && (
                      <div>
                        <p className="text-xs text-gray-500">IV</p>
                        <p className="font-medium text-white">
                          {(option.implied_volatility * 100).toFixed(1)}%
                        </p>
                      </div>
                    )}
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

export default function OptionsPage() {
  return (
    <Suspense>
      <OptionsInner />
    </Suspense>
  );
}
