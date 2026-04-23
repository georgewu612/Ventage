"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Bot,
  Clock,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { useI18n } from "@/lib/i18n/provider";

function parseAnalysis(
  raw: string | null | undefined,
  locale?: string,
): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object") {
        const text =
          (locale === "en"
            ? obj.conclusion_en || obj.conclusion
            : obj.conclusion || obj.conclusion_en) ??
          obj.summary ??
          obj.analysis ??
          obj.reasoning ??
          Object.values(obj).find((v) => typeof v === "string");
        if (typeof text === "string" && text.length > 0) return text;
      }
    } catch {
      // fall through
    }
  }
  return trimmed;
}

interface Factor {
  value: number;
  max: number;
  label: string;
}

interface Signal {
  id: string;
  symbol: string;
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;
  signal_type: string;
  analysis?: string | null;
  module?: string;
  signal_score?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  factors?: Record<string, any> | null;
  valid_until?: string | null;
  created_at: string;
}

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

export function SignalDetail({ signal }: { signal: Signal }) {
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
  const score = signal.signal_score ?? Math.round(signal.confidence * 100);

  const factors = signal.factors;
  const hasFactor =
    factors && typeof factors === "object" && Object.keys(factors).length > 0;

  // Capture current time once at render time via useState initializer (pure — runs only on mount)
  const [now] = useState(() => Date.now());
  const isExpired = signal.valid_until
    ? new Date(signal.valid_until).getTime() < now
    : false;

  const moduleLinks: Record<string, { href: string; labelKey: string }> = {
    options_flow: {
      href: `/dashboard/options?symbol=${signal.symbol}`,
      labelKey: "detail.viewOptions",
    },
    insider_trades: {
      href: `/dashboard/insider?symbol=${signal.symbol}`,
      labelKey: "detail.viewInsider",
    },
    market_sentiment: {
      href: `/dashboard/sentiment?symbol=${signal.symbol}`,
      labelKey: "detail.viewSentiment",
    },
  };

  const relatedLink = signal.module ? moduleLinks[signal.module] : undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-3xl font-bold text-white">
            ${signal.symbol}
          </span>
          <div
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium ${config.bg} ${config.color}`}
          >
            <Icon className="h-4 w-4" />
            {config.label}
          </div>
        </div>
        <span className={`text-3xl font-bold tabular-nums ${config.color}`}>
          {score}
        </span>
      </div>

      {/* Score bar */}
      <div className="h-2 overflow-hidden rounded-full bg-slate-700">
        <div
          className={`h-full ${config.barColor} transition-all duration-700`}
          style={{ width: `${score}%` }}
        />
      </div>

      {/* Full analysis */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-300">
          {t("detail.analysis")}
        </h3>
        <p className="leading-relaxed text-gray-100">
          {parseAnalysis(signal.analysis, locale) || "-"}
        </p>
      </div>

      {/* Factor breakdown */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-gray-300">
          {t("detail.factors")}
        </h3>
        {hasFactor ? (
          <div className="space-y-3">
            {Object.entries(factors!).map(([key, raw]) => {
              const factor = raw as Factor;
              if (!factor || typeof factor.value !== "number") return null;
              const pct =
                factor.max > 0 ? (factor.value / factor.max) * 100 : 0;
              return (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-gray-300">{factor.label}</span>
                    <span className="text-gray-400 tabular-nums">
                      {factor.value}/{factor.max}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-slate-700">
                    <div
                      className="h-full rounded bg-cyan-400 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {/* Total score */}
            <div className="border-t border-white/10 pt-3">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-white">
                  {t("detail.totalScore")}
                </span>
                <span className={`font-bold tabular-nums ${config.color}`}>
                  {score}/100
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded bg-slate-700">
                <div
                  className={`h-full rounded ${config.barColor} transition-all duration-500`}
                  style={{ width: `${score}%` }}
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">{t("detail.noFactors")}</p>
        )}
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-white/10 bg-white/5 p-4 text-sm">
        <div>
          <p className="text-xs text-gray-500">{t("filters.module")}</p>
          <p className="text-white">{signal.module || "-"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{t("signal.type")}</p>
          <p className="text-white capitalize">{signal.signal_type}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{t("signal.confidence")}</p>
          <p className="text-white">{Math.round(signal.confidence * 100)}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{t("detail.validUntil")}</p>
          <p className={isExpired ? "text-red-400" : "text-white"}>
            {signal.valid_until ? (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {isExpired
                  ? t("detail.expired")
                  : timeAgo(signal.valid_until, dateLocale)}
              </span>
            ) : (
              "-"
            )}
          </p>
        </div>
      </div>

      {/* Created at */}
      <p className="text-xs text-gray-500">
        {new Date(signal.created_at).toLocaleString(dateLocale)}
      </p>

      {/* Related data link */}
      {relatedLink && (
        <Link
          href={relatedLink.href}
          className="flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-300 transition-colors hover:bg-cyan-500/20"
        >
          <ArrowRight className="h-4 w-4" />
          {t(relatedLink.labelKey)}
        </Link>
      )}

      {/* Multi-Agent quick trigger */}
      <Link
        href={`/dashboard/multi-agent?symbol=${signal.symbol}`}
        className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm font-medium text-violet-300 transition-colors hover:bg-violet-500/20"
      >
        <Bot className="h-4 w-4" />
        {t("detail.triggerMultiAgent")}
      </Link>
    </div>
  );
}
