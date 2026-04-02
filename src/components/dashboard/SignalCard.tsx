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
  created_at: string;
}

export function SignalCard({ signal }: { signal: Signal }) {
  const { t, dateLocale } = useI18n();

  const directionConfig = {
    bullish: {
      icon: TrendingUp,
      color: "text-green-500",
      bg: "bg-green-500/10",
      border: "border-green-500/20",
      label: t("signal.bullish"),
    },
    bearish: {
      icon: TrendingDown,
      color: "text-red-500",
      bg: "bg-red-500/10",
      border: "border-red-500/20",
      label: t("signal.bearish"),
    },
    neutral: {
      icon: Minus,
      color: "text-yellow-500",
      bg: "bg-yellow-500/10",
      border: "border-yellow-500/20",
      label: t("signal.neutral"),
    },
  };

  const config = directionConfig[signal.direction];
  const Icon = config.icon;
  const confidencePercent = Math.round(signal.confidence * 100);

  return (
    <div
      className={`rounded-lg border ${config.border} ${config.bg} p-6 transition-all hover:shadow-lg`}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold">${signal.symbol}</span>
          <Icon className={`h-5 w-5 ${config.color}`} />
          <span
            className={`rounded px-2 py-1 text-xs ${config.bg} ${config.color}`}
          >
            {config.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/50 px-3 py-1 text-sm font-medium dark:bg-black/50">
            {confidencePercent}% {t("signal.confidence")}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <span className="font-medium">{t("signal.type")}:</span>
          <span className="capitalize">{signal.signal_type}</span>
        </div>

        {signal.analysis && (
          <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
            {signal.analysis}
          </p>
        )}

        <div className="mt-4 text-xs text-gray-500">
          {new Date(signal.created_at).toLocaleString(dateLocale)}
        </div>
      </div>
    </div>
  );
}
