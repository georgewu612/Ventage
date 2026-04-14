"use client";

import { useState } from "react";
import { Clock, Newspaper, Zap } from "lucide-react";

import { useMarketNews } from "@/lib/hooks/useMarketNews";
import { useI18n } from "@/lib/i18n/provider";

function timeAgo(dateStr: string, locale: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return locale === "zh-CN" ? "刚刚" : "just now";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return locale === "zh-CN" ? `${m}分钟前` : `${m}m ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return locale === "zh-CN" ? `${h}小时前` : `${h}h ago`;
  }
  const d = Math.floor(diff / 86400);
  return locale === "zh-CN" ? `${d}天前` : `${d}d ago`;
}

const CHANNEL_OPTIONS = [
  { value: "", label: "allChannels" },
  { value: "global-channel", label: "global" },
  { value: "us-stock-channel", label: "usStock" },
];

export default function NewsPage() {
  const { t, dateLocale } = useI18n();
  const [channelFilter, setChannelFilter] = useState("");
  const [importanceFilter, setImportanceFilter] = useState(0);
  const [symbolFilter, setSymbolFilter] = useState("");

  const { news, total, loading, error } = useMarketNews({
    channel: channelFilter || undefined,
    importance: importanceFilter || undefined,
    symbol: symbolFilter || undefined,
    limit: 50,
  });

  return (
    <div>
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Newspaper className="h-7 w-7 text-cyan-400" />
              <div>
                <h1 className="text-3xl font-bold text-white">
                  {t("news.title")}
                </h1>
                <p className="mt-1 text-gray-400">{t("news.subtitle")}</p>
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
              {t("news.channel")}
            </label>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-white"
            >
              {CHANNEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(`news.${opt.label}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t("news.importance")}
            </label>
            <select
              value={importanceFilter}
              onChange={(e) => setImportanceFilter(Number(e.target.value))}
              className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-white"
            >
              <option value={0}>{t("news.allImportance")}</option>
              <option value={2}>{t("news.high")} (2+)</option>
            </select>
          </div>
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
          <div className="flex items-end">
            <button
              onClick={() => {
                setChannelFilter("");
                setImportanceFilter(0);
                setSymbolFilter("");
              }}
              className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white hover:bg-white/20"
            >
              {t("filters.reset")}
            </button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-300">
            {error.message}
          </div>
        )}

        {/* Loading state */}
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-xl border border-white/10 bg-white/5 p-5"
              >
                <div className="mb-2 h-4 w-2/3 rounded bg-white/10" />
                <div className="mb-1 h-3 w-full rounded bg-white/10" />
                <div className="h-3 w-1/2 rounded bg-white/10" />
              </div>
            ))}
          </div>
        ) : news.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <div className="mb-4 text-5xl opacity-40">📰</div>
            <p className="text-lg text-gray-400">{t("news.empty")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {news.map((item) => (
              <div
                key={item.id}
                className="group rounded-xl border border-white/10 bg-white/5 p-5 transition-colors hover:bg-white/[0.08]"
              >
                <div className="mb-2 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    {item.title && (
                      <h3 className="mb-1 font-medium text-white">
                        {item.title}
                      </h3>
                    )}
                    <p className="line-clamp-3 text-sm leading-relaxed text-gray-300">
                      {item.content}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 text-xs text-gray-500">
                    <Clock className="h-3 w-3" />
                    <span
                      title={new Date(item.published_at).toLocaleString(
                        dateLocale,
                      )}
                    >
                      {timeAgo(item.published_at, dateLocale)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {item.importance >= 2 && (
                    <span className="flex items-center gap-1 rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-300">
                      <Zap className="h-3 w-3" />
                      {t("news.high")}
                    </span>
                  )}
                  {(item.symbols || []).map((s: string) => (
                    <span
                      key={s}
                      className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-xs text-cyan-300"
                    >
                      ${s}
                    </span>
                  ))}
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-gray-500">
                    {item.source}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
