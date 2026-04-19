"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Filter, Frown, Heart, Meh } from "lucide-react";

import { useMarketSentiment } from "@/lib/hooks/useMarketSentiment";
import { useI18n } from "@/lib/i18n/provider";

function getSentimentLabel(score: number | null): string {
  if (score === null) return "N/A";
  if (score > 0.3) return "Bullish";
  if (score < -0.3) return "Bearish";
  return "Neutral";
}

function SentimentBar({ score }: { score: number | null }) {
  if (score === null) return null;
  // score is -1 to 1, map to 0-100
  const pct = Math.round((score + 1) * 50);
  const color =
    score > 0.3
      ? "bg-emerald-500"
      : score < -0.3
        ? "bg-red-500"
        : "bg-yellow-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={`h-full ${color} transition-all duration-700`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function SentimentCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-6 w-16 rounded bg-white/10" />
          <div className="h-6 w-6 rounded-full bg-white/10" />
        </div>
        <div className="h-5 w-20 rounded-full bg-white/10" />
      </div>
      <div className="mb-4 h-1.5 w-full rounded-full bg-white/10" />
      <div className="mb-4 grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <div className="mb-1 h-3 w-12 rounded bg-white/10" />
            <div className="h-5 w-16 rounded bg-white/10" />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-5 w-14 rounded bg-white/10" />
        ))}
      </div>
    </div>
  );
}

function SentimentInner() {
  const searchParams = useSearchParams();
  const { sentiments, loading, error } = useMarketSentiment(30);
  const { t, dateLocale } = useI18n();
  const [symbolFilter, setSymbolFilter] = useState(
    (searchParams.get("symbol") ?? "").toUpperCase(),
  );
  const [sentimentFilter, setSentimentFilter] = useState<
    "" | "bullish" | "bearish" | "neutral"
  >("");

  const filtered = sentiments.filter((s) => {
    if (symbolFilter && !s.symbol.includes(symbolFilter.toUpperCase()))
      return false;
    if (sentimentFilter) {
      const label = getSentimentLabel(s.sentiment_score).toLowerCase();
      if (label !== sentimentFilter) return false;
    }
    return true;
  });

  const bullishCount = sentiments.filter(
    (s) => s.sentiment_score !== null && s.sentiment_score > 0.3,
  ).length;
  const bearishCount = sentiments.filter(
    (s) => s.sentiment_score !== null && s.sentiment_score < -0.3,
  ).length;
  const neutralCount = sentiments.length - bullishCount - bearishCount;

  return (
    <div>
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">
                {t("nav.sentiment")}
              </h1>
              <p className="mt-1 text-gray-400">{t("sentiment.subtitle")}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-400">
                {bullishCount} Bullish
              </span>
              <span className="rounded-lg bg-yellow-500/10 px-3 py-1.5 text-sm font-medium text-yellow-400">
                {neutralCount} Neutral
              </span>
              <span className="rounded-lg bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-400">
                {bearishCount} Bearish
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
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
            {(["", "bullish", "neutral", "bearish"] as const).map((type) => (
              <button
                key={type || "all"}
                onClick={() => setSentimentFilter(type)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  sentimentFilter === type
                    ? "bg-white/15 text-white"
                    : "text-gray-400 hover:text-white"
                } ${type === "" ? "rounded-l-lg" : ""} ${type === "bearish" ? "rounded-r-lg" : ""}`}
              >
                {type === ""
                  ? "All"
                  : type.charAt(0).toUpperCase() + type.slice(1)}
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <SentimentCardSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-20">
            <div className="mb-4 text-5xl opacity-40">📭</div>
            <p className="text-lg text-gray-400">{t("sentiment.empty")}</p>
          </div>
        ) : (
          <div className="animate-stagger grid grid-cols-1 gap-4 md:grid-cols-2">
            {filtered.map((sentiment) => {
              const score = sentiment.sentiment_score;
              const label = getSentimentLabel(score);
              const Icon =
                label === "Bullish" ? Heart : label === "Bearish" ? Frown : Meh;
              const iconColor =
                label === "Bullish"
                  ? "text-emerald-400"
                  : label === "Bearish"
                    ? "text-red-400"
                    : "text-yellow-400";
              const badgeBg =
                label === "Bullish"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : label === "Bearish"
                    ? "bg-red-500/15 text-red-400"
                    : "bg-yellow-500/15 text-yellow-400";

              return (
                <div
                  key={sentiment.id}
                  className="animate-fade-in rounded-xl border border-white/10 bg-white/5 p-5 transition-all duration-200 hover:bg-white/[0.08]"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-bold text-white">
                        ${sentiment.symbol}
                      </span>
                      <div
                        className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeBg}`}
                      >
                        <Icon className={`h-3 w-3 ${iconColor}`} />
                        {label}
                      </div>
                    </div>
                    <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-medium text-blue-400">
                      {sentiment.source}
                    </span>
                  </div>

                  {score !== null && (
                    <div className="mb-4">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-gray-500">Sentiment</span>
                        <span className={`font-bold tabular-nums ${iconColor}`}>
                          {(score * 100).toFixed(0)}%
                        </span>
                      </div>
                      <SentimentBar score={score} />
                    </div>
                  )}

                  <div className="mb-3 grid grid-cols-3 gap-x-6 gap-y-2 text-sm">
                    {sentiment.magnitude != null && (
                      <div>
                        <p className="text-xs text-gray-500">Magnitude</p>
                        <p className="font-medium text-white tabular-nums">
                          {(sentiment.magnitude * 100).toFixed(0)}%
                        </p>
                      </div>
                    )}
                    {sentiment.volume != null && (
                      <div>
                        <p className="text-xs text-gray-500">Volume</p>
                        <p className="font-medium text-white tabular-nums">
                          {sentiment.volume.toLocaleString()}
                        </p>
                      </div>
                    )}
                    {sentiment.analysis_window && (
                      <div>
                        <p className="text-xs text-gray-500">Window</p>
                        <p className="font-medium text-white">
                          {sentiment.analysis_window}
                        </p>
                      </div>
                    )}
                  </div>

                  {sentiment.keywords &&
                    Object.keys(sentiment.keywords).length > 0 && (
                      <div className="mb-3">
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(sentiment.keywords)
                            .slice(0, 5)
                            .map(([keyword, count]) => (
                              <span
                                key={keyword}
                                className="rounded bg-white/5 px-2 py-0.5 text-xs text-gray-400"
                              >
                                {keyword}
                                <span className="ml-1 text-gray-600">
                                  {count}
                                </span>
                              </span>
                            ))}
                        </div>
                      </div>
                    )}

                  <div className="text-xs text-gray-500">
                    {new Date(sentiment.created_at).toLocaleString(dateLocale)}
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

export default function SentimentPage() {
  return (
    <Suspense>
      <SentimentInner />
    </Suspense>
  );
}
