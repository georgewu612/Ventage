"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { useI18n } from "@/lib/i18n/provider";

interface Signal {
  id: string;
  symbol: string;
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;
  signal_type: string;
  analysis?: string | null;
  module?: string;
  signal_score?: number;
  created_at: string;
}

/** Returns true if the string contains CJK characters */
function hasChinese(s: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(s);
}

/**
 * Parse analysis text — may be a raw string or a JSON object.
 * Extracts `conclusion` / `summary` / first string value found.
 * In English mode, returns "" for plain Chinese-only strings.
 */
function parseAnalysis(
  raw: string | null | undefined,
  locale?: string,
): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  // Try JSON parse
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object") {
        // Prefer locale-specific conclusion when available
        const text =
          (locale === "en"
            ? obj.conclusion_en || obj.conclusion
            : obj.conclusion || obj.conclusion_en) ??
          obj.summary ??
          obj.analysis ??
          obj.reasoning ??
          Object.values(obj).find((v) => typeof v === "string");
        if (typeof text === "string" && text.length > 0) {
          // In English mode, skip Chinese-only results
          if (locale === "en" && hasChinese(text) && !/[a-zA-Z]{3}/.test(text))
            return "";
          return text;
        }
      }
    } catch {
      // not valid JSON, fall through
    }
  }
  // Plain string: in English mode suppress Chinese-only text
  if (locale === "en" && hasChinese(trimmed) && !/[a-zA-Z]{3}/.test(trimmed))
    return "";
  return trimmed;
}

// ── Localization maps for raw backend strings ─────────────────────────────────
const MODULE_LABEL: Record<string, { zh: string; en: string }> = {
  options_flow: { zh: "期权异动", en: "Options Flow" },
  insider_trade: { zh: "内部交易", en: "Insider" },
  insider: { zh: "内部交易", en: "Insider" },
  dark_pool: { zh: "暗池", en: "Dark Pool" },
  darkpool: { zh: "暗池", en: "Dark Pool" },
  sentiment: { zh: "情绪", en: "Sentiment" },
  technical: { zh: "技术面", en: "Technical" },
  news: { zh: "新闻", en: "News" },
  earnings: { zh: "财报", en: "Earnings" },
  fundamental: { zh: "基本面", en: "Fundamental" },
};

const SIGNAL_TYPE_LABEL: Record<string, { zh: string; en: string }> = {
  bullish: { zh: "看涨", en: "Bullish" },
  bearish: { zh: "看跌", en: "Bearish" },
  neutral: { zh: "中性", en: "Neutral" },
  unusual_options: { zh: "异动期权", en: "Unusual Options" },
  unusual: { zh: "异动", en: "Unusual" },
  large_buy: { zh: "大额买入", en: "Large Buy" },
  large_sell: { zh: "大额卖出", en: "Large Sell" },
  cluster_buy: { zh: "集中买入", en: "Cluster Buy" },
  breakout: { zh: "突破", en: "Breakout" },
  reversal: { zh: "反转", en: "Reversal" },
};

function localizeModule(raw: string, isZh: boolean): string {
  const key = raw.toLowerCase().trim();
  const entry = MODULE_LABEL[key];
  if (entry) return isZh ? entry.zh : entry.en;
  // fallback: replace underscores with spaces, title-case
  return raw
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function localizeSignalType(raw: string, isZh: boolean): string {
  const key = raw.toLowerCase().trim();
  const entry = SIGNAL_TYPE_LABEL[key];
  if (entry) return isZh ? entry.zh : entry.en;
  return raw
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function timeAgo(dateStr: string, locale: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  const isZh = locale === "zh" || locale === "zh-CN";

  if (diff < 60) return isZh ? "刚刚" : "just now";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return isZh ? `${m}分钟前` : `${m}m ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return isZh ? `${h}小时前` : `${h}h ago`;
  }
  const d = Math.floor(diff / 86400);
  return isZh ? `${d}天前` : `${d}d ago`;
}

export function SignalCard({
  signal,
  onClick,
}: {
  signal: Signal;
  onClick?: () => void;
}) {
  const { t, locale, dateLocale } = useI18n();

  const directionConfig = {
    bullish: {
      icon: TrendingUp,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20",
      barColor: "bg-emerald-500",
      label: t("signal.bullish"),
    },
    bearish: {
      icon: TrendingDown,
      color: "text-red-400",
      bg: "bg-red-500/10",
      border: "border-red-500/20",
      barColor: "bg-red-500",
      label: t("signal.bearish"),
    },
    neutral: {
      icon: Minus,
      color: "text-yellow-400",
      bg: "bg-yellow-500/10",
      border: "border-yellow-500/20",
      barColor: "bg-yellow-500",
      label: t("signal.neutral"),
    },
  };

  const config = directionConfig[signal.direction];
  const Icon = config.icon;
  const confidencePercent = Math.round(signal.confidence * 100);
  const score = signal.signal_score ?? confidencePercent;

  return (
    <div
      onClick={onClick}
      className={`group relative overflow-hidden rounded-xl border ${config.border} ${config.bg} p-5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-black/20 ${onClick ? "cursor-pointer" : ""}`}
    >
      {/* Confidence bar at top */}
      <div className="absolute inset-x-0 top-0 h-1 bg-white/5">
        <div
          className={`h-full ${config.barColor} transition-all duration-700`}
          style={{ width: `${confidencePercent}%` }}
        />
      </div>

      <div className="mb-3 flex items-center justify-between pt-1">
        <div className="flex items-center gap-2.5">
          <span className="text-xl font-bold text-white">${signal.symbol}</span>
          <div
            className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${config.bg} ${config.color}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {config.label}
          </div>
        </div>
        <span className={`text-2xl font-bold tabular-nums ${config.color}`}>
          {confidencePercent}%
        </span>
      </div>

      {signal.analysis &&
        (() => {
          const text = parseAnalysis(signal.analysis, locale);
          return text ? (
            <p className="mb-3 line-clamp-2 text-sm leading-relaxed text-gray-100">
              {text}
            </p>
          ) : null;
        })()}

      <div className="flex items-center justify-between text-xs text-gray-400">
        <div className="flex items-center gap-3">
          {signal.module && (
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-gray-400">
              {localizeModule(signal.module, locale === "zh")}
            </span>
          )}
          <span>{localizeSignalType(signal.signal_type, locale === "zh")}</span>
        </div>
        <span title={new Date(signal.created_at).toLocaleString(dateLocale)}>
          {timeAgo(signal.created_at, dateLocale)}
        </span>
      </div>
    </div>
  );
}

export function SignalCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="mb-3 flex items-center justify-between pt-1">
        <div className="flex items-center gap-2.5">
          <div className="h-6 w-16 rounded bg-white/10" />
          <div className="h-5 w-12 rounded bg-white/10" />
        </div>
        <div className="h-7 w-10 rounded bg-white/10" />
      </div>
      <div className="mb-3 space-y-2">
        <div className="h-4 w-full rounded bg-white/10" />
        <div className="h-4 w-2/3 rounded bg-white/10" />
      </div>
      <div className="flex items-center justify-between">
        <div className="h-3 w-20 rounded bg-white/10" />
        <div className="h-3 w-14 rounded bg-white/10" />
      </div>
    </div>
  );
}
