"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Filter, TrendingDown, TrendingUp, User } from "lucide-react";

import { useInsiderTrades } from "@/lib/hooks/useInsiderTrades";
import { useI18n } from "@/lib/i18n/provider";

function formatValue(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function InsiderCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-6 w-16 rounded bg-white/10" />
          <div className="h-6 w-14 rounded-full bg-white/10" />
        </div>
        <div className="h-6 w-24 rounded bg-white/10" />
      </div>
      <div className="mb-3 flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-white/10" />
        <div>
          <div className="mb-1 h-4 w-28 rounded bg-white/10" />
          <div className="h-3 w-16 rounded bg-white/10" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <div className="mb-1 h-3 w-12 rounded bg-white/10" />
            <div className="h-5 w-16 rounded bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}

function InsiderInner() {
  const searchParams = useSearchParams();
  const { trades, loading, error } = useInsiderTrades(50);
  const { t, dateLocale } = useI18n();
  const [typeFilter, setTypeFilter] = useState<"" | "BUY" | "SELL">("");
  const [symbolFilter, setSymbolFilter] = useState(
    (searchParams.get("symbol") ?? "").toUpperCase(),
  );

  const filtered = trades.filter((tr) => {
    if (typeFilter && tr.trade_type !== typeFilter) return false;
    if (symbolFilter && !tr.symbol.includes(symbolFilter.toUpperCase()))
      return false;
    return true;
  });

  // Aggregate stats
  const buyCount = filtered.filter((t) => t.trade_type === "BUY").length;
  const sellCount = filtered.filter((t) => t.trade_type === "SELL").length;

  // Symbol-level summary (unfiltered data)
  const symbolGroups = Object.values(
    trades.reduce<
      Record<
        string,
        {
          symbol: string;
          buys: number;
          sells: number;
          buyValue: number;
          sellValue: number;
        }
      >
    >((acc, tr) => {
      if (!acc[tr.symbol]) {
        acc[tr.symbol] = {
          symbol: tr.symbol,
          buys: 0,
          sells: 0,
          buyValue: 0,
          sellValue: 0,
        };
      }
      const g = acc[tr.symbol];
      if (tr.trade_type === "BUY") {
        g.buys++;
        g.buyValue += tr.value ?? 0;
      } else {
        g.sells++;
        g.sellValue += tr.value ?? 0;
      }
      return acc;
    }, {}),
  ).sort((a, b) => b.buys + b.sells - (a.buys + a.sells));

  return (
    <div>
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">
                {t("nav.insider")}
              </h1>
              <p className="mt-1 text-gray-400">{t("insider.subtitle")}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-400">
                {buyCount} BUY
              </span>
              <span className="rounded-lg bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-400">
                {sellCount} SELL
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
                const netValue = g.buyValue - g.sellValue;
                const isBullish = netValue >= 0;
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
                        {isBullish ? "↑ 净买" : "↓ 净卖"}
                      </span>
                    </div>
                    <div className="flex gap-3 text-xs">
                      <span className="text-emerald-400">
                        B {g.buys}{" "}
                        <span className="text-emerald-600">
                          {formatValue(g.buyValue)}
                        </span>
                      </span>
                      <span className="text-red-400">
                        S {g.sells}{" "}
                        <span className="text-red-600">
                          {formatValue(g.sellValue)}
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      B-S {isBullish ? "+" : "-"}
                      {formatValue(Math.abs(netValue))}
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
            {(["", "BUY", "SELL"] as const).map((type) => (
              <button
                key={type || "all"}
                onClick={() => setTypeFilter(type)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  typeFilter === type
                    ? "bg-white/15 text-white"
                    : "text-gray-400 hover:text-white"
                } ${type === "" ? "rounded-l-lg" : ""} ${type === "SELL" ? "rounded-r-lg" : ""}`}
              >
                {type === "" ? "All" : type}
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
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <InsiderCardSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-20">
            <div className="mb-4 text-5xl opacity-40">📭</div>
            <p className="text-lg text-gray-400">{t("insider.empty")}</p>
          </div>
        ) : (
          <div className="animate-stagger space-y-3">
            {filtered.map((trade) => {
              const isBuy = trade.trade_type === "BUY";
              const isZeroPrice = trade.price === 0 || trade.price == null;
              const isAward = isBuy && isZeroPrice;
              const isTaxWithhold = !isBuy && isZeroPrice;
              const hasValue = trade.value != null && trade.value > 0;
              return (
                <div
                  key={trade.id}
                  className="animate-fade-in rounded-xl border border-white/10 bg-white/5 p-5 transition-all duration-200 hover:bg-white/[0.08]"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-bold text-white">
                        ${trade.symbol}
                      </span>
                      <div
                        className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          isBuy
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-red-500/15 text-red-400"
                        }`}
                      >
                        {isBuy ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {trade.trade_type}
                      </div>
                      {isAward && (
                        <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-400">
                          {t("insider.awardBadge")}
                        </span>
                      )}
                      {isTaxWithhold && (
                        <span className="rounded-full bg-slate-500/30 px-2.5 py-0.5 text-xs font-medium text-slate-400">
                          {t("insider.taxBadge")}
                        </span>
                      )}
                    </div>
                    {hasValue && (
                      <span
                        className={`text-lg font-bold tabular-nums ${isBuy ? "text-emerald-400" : "text-red-400"}`}
                      >
                        {formatValue(trade.value!)}
                      </span>
                    )}
                  </div>

                  <div className="mb-3 flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
                      <User className="h-4 w-4 text-gray-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">
                        {trade.insider_name}
                      </p>
                      {trade.insider_title && (
                        <p className="text-xs text-gray-500">
                          {trade.insider_title}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
                    <div>
                      <p className="text-xs text-gray-500">Shares</p>
                      <p className="font-medium text-white tabular-nums">
                        {trade.shares.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Price</p>
                      {isAward ? (
                        <p className="text-xs font-medium text-amber-400">
                          {t("insider.awardPrice")}
                        </p>
                      ) : isTaxWithhold ? (
                        <p className="text-xs font-medium text-slate-400">
                          {t("insider.taxPrice")}
                        </p>
                      ) : trade.price != null ? (
                        <p className="font-medium text-white tabular-nums">
                          ${trade.price.toFixed(2)}
                        </p>
                      ) : (
                        <p className="text-gray-500">—</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Filing Date</p>
                      <p className="font-medium text-white">
                        {new Date(trade.filing_date).toLocaleDateString(
                          dateLocale,
                        )}
                      </p>
                    </div>
                    {trade.sec_form && (
                      <div>
                        <p className="text-xs text-gray-500">Form</p>
                        <p className="font-medium text-white">
                          {trade.sec_form}
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

export default function InsiderPage() {
  return (
    <Suspense>
      <InsiderInner />
    </Suspense>
  );
}
