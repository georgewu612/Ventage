"use client";

import { TrendingDown, TrendingUp } from "lucide-react";

import { useInsiderTrades } from "@/lib/hooks/useInsiderTrades";
import { useI18n } from "@/lib/i18n/provider";

export default function InsiderPage() {
  const { trades, loading, error } = useInsiderTrades(30);
  const { t, dateLocale } = useI18n();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-2xl text-white">{t("common.loading")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-xl text-red-500">
          {t("common.error")}: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div>
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div>
            <h1 className="text-3xl font-bold text-white">
              {t("nav.insider")}
            </h1>
            <p className="mt-1 text-gray-400">{t("insider.subtitle")}</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {trades.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-lg text-gray-400">{t("insider.empty")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {trades.map((trade) => (
              <div
                key={trade.id}
                className="rounded-lg border border-white/10 bg-white/5 p-6 transition-all hover:bg-white/10"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-2xl font-bold text-white">
                      ${trade.symbol}
                    </span>
                    <div
                      className={`flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium ${
                        trade.trade_type === "BUY"
                          ? "bg-green-500/20 text-green-300"
                          : "bg-red-500/20 text-red-300"
                      }`}
                    >
                      {trade.trade_type === "BUY" ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : (
                        <TrendingDown className="h-4 w-4" />
                      )}
                      {trade.trade_type}
                    </div>
                  </div>
                  {trade.value && (
                    <div className="text-xl font-bold text-white">
                      ${trade.value.toLocaleString()}
                    </div>
                  )}
                </div>

                <div className="mb-3">
                  <p className="font-medium text-white">{trade.insider_name}</p>
                  {trade.insider_title && (
                    <p className="text-sm text-gray-400">
                      {trade.insider_title}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
                  <div>
                    <p className="text-gray-500">Shares</p>
                    <p className="font-medium text-white">
                      {trade.shares.toLocaleString()}
                    </p>
                  </div>
                  {trade.price && (
                    <div>
                      <p className="text-gray-500">Price</p>
                      <p className="font-medium text-white">
                        ${trade.price.toFixed(2)}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-gray-500">Filing Date</p>
                    <p className="font-medium text-white">
                      {new Date(trade.filing_date).toLocaleDateString(
                        dateLocale,
                      )}
                    </p>
                  </div>
                </div>

                <div className="mt-4 text-xs text-gray-500">
                  {new Date(trade.created_at).toLocaleString(dateLocale)}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
