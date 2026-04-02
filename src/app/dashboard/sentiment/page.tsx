"use client";

import { Frown, Heart, Meh } from "lucide-react";

import { useMarketSentiment } from "@/lib/hooks/useMarketSentiment";
import { useI18n } from "@/lib/i18n/provider";

export default function SentimentPage() {
  const { sentiments, loading, error } = useMarketSentiment(30);
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

  const getSentimentIcon = (score: number | null) => {
    if (score === null) return <Meh className="h-5 w-5 text-gray-400" />;
    if (score > 0.3) return <Heart className="h-5 w-5 text-green-400" />;
    if (score < -0.3) return <Frown className="h-5 w-5 text-red-400" />;
    return <Meh className="h-5 w-5 text-yellow-400" />;
  };

  const getSentimentColor = (score: number | null) => {
    if (score === null) return "bg-gray-500/20 text-gray-300";
    if (score > 0.3) return "bg-green-500/20 text-green-300";
    if (score < -0.3) return "bg-red-500/20 text-red-300";
    return "bg-yellow-500/20 text-yellow-300";
  };

  return (
    <div>
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div>
            <h1 className="text-3xl font-bold text-white">
              {t("nav.sentiment")}
            </h1>
            <p className="mt-1 text-gray-400">{t("sentiment.subtitle")}</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {sentiments.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-lg text-gray-400">{t("sentiment.empty")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {sentiments.map((sentiment) => (
              <div
                key={sentiment.id}
                className="rounded-lg border border-white/10 bg-white/5 p-6 transition-all hover:bg-white/10"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-white">
                      ${sentiment.symbol}
                    </span>
                    {getSentimentIcon(sentiment.sentiment_score)}
                  </div>
                  <div className="rounded-full bg-blue-500/20 px-3 py-1 text-xs font-medium text-blue-300">
                    {sentiment.source}
                  </div>
                </div>

                {sentiment.sentiment_score !== null && (
                  <div className="mb-4">
                    <div
                      className={`inline-block rounded-lg px-4 py-2 ${getSentimentColor(sentiment.sentiment_score)}`}
                    >
                      <span className="font-bold">
                        Sentiment:{" "}
                        {(sentiment.sentiment_score * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                )}

                <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
                  {sentiment.magnitude !== null && (
                    <div>
                      <p className="text-gray-500">Magnitude</p>
                      <p className="font-medium text-white">
                        {(sentiment.magnitude * 100).toFixed(0)}%
                      </p>
                    </div>
                  )}
                  {sentiment.volume !== null && (
                    <div>
                      <p className="text-gray-500">Volume</p>
                      <p className="font-medium text-white">
                        {sentiment.volume.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>

                {sentiment.keywords &&
                  Object.keys(sentiment.keywords).length > 0 && (
                    <div className="mb-3">
                      <p className="mb-2 text-xs text-gray-500">Keywords</p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(sentiment.keywords)
                          .slice(0, 5)
                          .map(([keyword, count]) => (
                            <span
                              key={keyword}
                              className="rounded bg-white/10 px-2 py-1 text-xs text-gray-300"
                            >
                              {keyword}:{count}
                            </span>
                          ))}
                      </div>
                    </div>
                  )}

                <div className="mt-4 text-xs text-gray-500">
                  {sentiment.analysis_window} ·{" "}
                  {new Date(sentiment.created_at).toLocaleString(dateLocale)}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
