"use client";

import { useState } from "react";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Brain,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";

import { useDailyReport } from "@/lib/hooks/useDailyReport";
import { useI18n } from "@/lib/i18n/provider";

function ReportSection({
  icon: Icon,
  title,
  content,
  color,
}: {
  icon: React.ElementType;
  title: string;
  content: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className={`mb-3 flex items-center gap-2 ${color}`}>
        <Icon className="h-5 w-5" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-line text-gray-300">
        {content}
      </p>
    </div>
  );
}

export default function ReportsPage() {
  const { t } = useI18n();
  const { report, loading, error, generate } = useDailyReport();

  return (
    <div>
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">
                {t("nav.reports")}
              </h1>
              <p className="mt-1 text-gray-400">{t("reports.subtitle")}</p>
            </div>
            <div className="flex items-center gap-3">
              {report && (
                <span className="text-xs text-gray-500">
                  {t("reports.model")}: {report.model} | Tokens: {report.tokens}
                </span>
              )}
              <button
                onClick={generate}
                disabled={loading}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500/20 to-purple-500/20 px-5 py-2.5 text-sm font-medium text-white transition-all hover:from-cyan-500/30 hover:to-purple-500/30 disabled:opacity-50"
              >
                {loading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {loading
                  ? t("reports.generating")
                  : t("reports.generateReport")}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {error ? (
          <div className="flex flex-col items-center py-20">
            <div className="mb-4 text-4xl">⚠️</div>
            <div className="mb-2 text-red-400">{error.message}</div>
            <p className="text-sm text-gray-500">{t("reports.errorHint")}</p>
          </div>
        ) : !report && !loading ? (
          <div className="flex flex-col items-center py-20">
            <Brain className="mb-6 h-16 w-16 text-cyan-400/40" />
            <h2 className="mb-2 text-xl font-medium text-white">
              {t("reports.emptyTitle")}
            </h2>
            <p className="mb-6 text-center text-sm text-gray-400">
              {t("reports.emptyDesc")}
            </p>
            <button
              onClick={generate}
              className="flex items-center gap-2 rounded-lg bg-cyan-500/20 px-6 py-3 text-cyan-300 transition-colors hover:bg-cyan-500/30"
            >
              <Sparkles className="h-4 w-4" />
              {t("reports.generateReport")}
            </button>
          </div>
        ) : loading && !report ? (
          <div className="flex flex-col items-center py-20">
            <RefreshCw className="mb-4 h-10 w-10 animate-spin text-cyan-400" />
            <p className="text-gray-400">{t("reports.generating")}</p>
            <p className="mt-2 text-xs text-gray-500">
              {t("reports.generatingHint")}
            </p>
          </div>
        ) : report ? (
          <div className="animate-fade-in space-y-4">
            {/* Report timestamp */}
            <div className="mb-6 flex items-center gap-2 text-xs text-gray-500">
              <Sparkles className="h-3 w-3" />
              {t("reports.generatedAt")}{" "}
              {new Date(report.generated_at).toLocaleString()}
              {loading && (
                <RefreshCw className="ml-2 h-3 w-3 animate-spin text-cyan-400" />
              )}
            </div>

            {/* Report sections */}
            <ReportSection
              icon={BarChart3}
              title={t("reports.marketOverview")}
              content={report.market_overview}
              color="text-cyan-400"
            />

            <div className="grid gap-4 md:grid-cols-2">
              <ReportSection
                icon={TrendingUp}
                title={t("reports.topBullish")}
                content={report.top_bullish}
                color="text-emerald-400"
              />
              <ReportSection
                icon={TrendingDown}
                title={t("reports.topBearish")}
                content={report.top_bearish}
                color="text-red-400"
              />
            </div>

            <ReportSection
              icon={Zap}
              title={t("reports.unusualActivity")}
              content={report.unusual_activity}
              color="text-yellow-400"
            />

            <ReportSection
              icon={AlertTriangle}
              title={t("reports.riskWarning")}
              content={report.risk_warning}
              color="text-orange-400"
            />

            {/* Disclaimer */}
            <div className="rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-xs text-gray-500">
              {t("reports.disclaimer")}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
