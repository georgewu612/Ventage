"use client";

import { ArrowDown, ArrowUp } from "lucide-react";

import { useOptionsFlow } from "@/lib/hooks/useOptionsFlow";
import { useI18n } from "@/lib/i18n/provider";

export default function OptionsPage() {
  const { options, loading, error } = useOptionsFlow(30);
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
              {t("nav.options")}
            </h1>
            <p className="mt-1 text-gray-400">{t("options.subtitle")}</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {options.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-lg text-gray-400">{t("options.empty")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {options.map((option) => (
              <div
                key={option.id}
                className="rounded-lg border border-white/10 bg-white/5 p-6 transition-all hover:bg-white/10"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-2xl font-bold text-white">
                      ${option.symbol}
                    </span>
                    <div
                      className={`rounded-full px-3 py-1 text-sm font-medium ${
                        option.option_type === "call"
                          ? "bg-green-500/20 text-green-300"
                          : "bg-red-500/20 text-red-300"
                      }`}
                    >
                      {option.option_type.toUpperCase()}
                      {option.option_type === "call" ? (
                        <ArrowUp className="ml-1 inline h-4 w-4" />
                      ) : (
                        <ArrowDown className="ml-1 inline h-4 w-4" />
                      )}
                    </div>
                  </div>
                  {option.unusual_score && (
                    <div className="font-bold text-yellow-400">
                      Unusual Score: {option.unusual_score.toFixed(2)}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="text-gray-500">Strike</p>
                    <p className="font-medium text-white">${option.strike}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Expiration</p>
                    <p className="font-medium text-white">
                      {new Date(option.expiration).toLocaleDateString(
                        dateLocale,
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Premium</p>
                    <p className="font-medium text-white">
                      ${option.premium.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Volume</p>
                    <p className="font-medium text-white">
                      {option.volume.toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="mt-4 text-xs text-gray-500">
                  {new Date(option.created_at).toLocaleString(dateLocale)}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
