"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import {
  AlertTriangle,
  BarChart3,
  Brain,
  Briefcase,
  MessageSquare,
  Newspaper,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

import { useMultiAgentAnalysis } from "@/lib/hooks/useMultiAgentAnalysis";
import { useI18n } from "@/lib/i18n/provider";

const POPULAR_SYMBOLS = [
  "NVDA",
  "TSLA",
  "AAPL",
  "MSFT",
  "META",
  "AMZN",
  "GOOGL",
  "AMD",
];

function AgentCard({
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
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > 300;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div
        className={`mb-2 flex items-center gap-2 ${color}`}
        onClick={() => isLong && setExpanded(!expanded)}
        role={isLong ? "button" : undefined}
      >
        <Icon className="h-4 w-4" />
        <h4 className="text-sm font-semibold">{title}</h4>
        {isLong && (
          <span className="ml-auto text-xs opacity-50">
            {expanded ? "▲" : "▼"}
          </span>
        )}
      </div>
      <p
        className={`text-xs leading-relaxed whitespace-pre-line text-gray-300 ${
          !expanded && isLong ? "line-clamp-4" : ""
        }`}
      >
        {content}
      </p>
    </div>
  );
}

function MultiAgentInner() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [inputValue, setInputValue] = useState(
    searchParams.get("symbol")?.toUpperCase() || "NVDA",
  );
  const { result, loading, error, analyze } = useMultiAgentAnalysis();

  const handleAnalyze = () => {
    const s = inputValue.trim().toUpperCase();
    if (s) analyze(s);
  };

  return (
    <div>
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div>
            <h1 className="text-3xl font-bold text-white">
              {t("multiAgent.title")}
            </h1>
            <p className="mt-1 text-gray-400">{t("multiAgent.subtitle")}</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Search bar */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                placeholder={t("multiAgent.inputPlaceholder")}
                className="w-36 rounded-lg border border-white/10 bg-white/5 py-2 pr-3 pl-9 text-sm text-white placeholder:text-gray-500"
              />
            </div>
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500/20 to-cyan-500/20 px-5 py-2 text-sm font-medium text-white transition-all hover:from-purple-500/30 hover:to-cyan-500/30 disabled:opacity-50"
            >
              {loading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Users className="h-4 w-4" />
              )}
              {loading ? t("multiAgent.analyzing") : t("multiAgent.analyze")}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {POPULAR_SYMBOLS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setInputValue(s);
                  analyze(s);
                }}
                className="rounded-md bg-white/5 px-2.5 py-1 text-xs font-medium text-gray-400 transition-colors hover:text-white"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Cost warning */}
        <div className="mb-6 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-2 text-xs text-yellow-400/80">
          ⚡ {t("multiAgent.costWarning")}
        </div>

        {error ? (
          <div className="flex flex-col items-center py-20">
            <div className="mb-4 text-4xl">⚠️</div>
            <div className="text-red-400">{error.message}</div>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center py-20">
            <div className="relative mb-6">
              <Brain className="h-16 w-16 animate-pulse text-purple-400" />
              <RefreshCw className="absolute -right-2 -bottom-2 h-6 w-6 animate-spin text-cyan-400" />
            </div>
            <p className="text-lg text-white">{t("multiAgent.analyzing")}</p>
            <p className="mt-2 text-sm text-gray-400">
              {t("multiAgent.analyzingHint")}
            </p>
          </div>
        ) : result ? (
          <div className="animate-fade-in space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-purple-400" />
              <span className="text-xs text-gray-500">
                ${result.symbol} · {result.date} · {result.model} ·{" "}
                {new Date(result.generated_at).toLocaleTimeString()}
              </span>
            </div>

            {/* Final Decision */}
            <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-6">
              <div className="mb-3 flex items-center gap-2 text-purple-400">
                <Briefcase className="h-5 w-5" />
                <h3 className="text-sm font-semibold">
                  {t("multiAgent.finalDecision")}
                </h3>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-line text-gray-200">
                {result.decision}
              </p>
            </div>

            {/* Agent Reports */}
            <h3 className="text-sm font-semibold text-gray-400">
              {t("multiAgent.agentReports")}
            </h3>

            <div className="grid gap-4 md:grid-cols-2">
              {result.fundamentals_report && (
                <AgentCard
                  icon={BarChart3}
                  title={t("multiAgent.fundamentals")}
                  content={result.fundamentals_report}
                  color="text-cyan-400"
                />
              )}
              {result.sentiment_report && (
                <AgentCard
                  icon={MessageSquare}
                  title={t("multiAgent.sentiment")}
                  content={result.sentiment_report}
                  color="text-yellow-400"
                />
              )}
              {result.news_report && (
                <AgentCard
                  icon={Newspaper}
                  title={t("multiAgent.news")}
                  content={result.news_report}
                  color="text-blue-400"
                />
              )}
              {result.technical_report && (
                <AgentCard
                  icon={BarChart3}
                  title={t("multiAgent.technical")}
                  content={result.technical_report}
                  color="text-emerald-400"
                />
              )}
              {result.bull_report && (
                <AgentCard
                  icon={TrendingUp}
                  title={t("multiAgent.bull")}
                  content={result.bull_report}
                  color="text-emerald-400"
                />
              )}
              {result.bear_report && (
                <AgentCard
                  icon={TrendingDown}
                  title={t("multiAgent.bear")}
                  content={result.bear_report}
                  color="text-red-400"
                />
              )}
              {result.risk_report && (
                <AgentCard
                  icon={Shield}
                  title={t("multiAgent.risk")}
                  content={result.risk_report}
                  color="text-orange-400"
                />
              )}
              {result.trader_decision && (
                <AgentCard
                  icon={Briefcase}
                  title={t("multiAgent.trader")}
                  content={result.trader_decision}
                  color="text-purple-400"
                />
              )}
            </div>

            {/* Disclaimer */}
            <div className="rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-xs text-gray-500">
              {t("reports.disclaimer")}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center py-20">
            <Users className="mb-6 h-16 w-16 text-purple-400/40" />
            <h2 className="mb-2 text-xl font-medium text-white">
              {t("multiAgent.emptyTitle")}
            </h2>
            <p className="text-center text-sm text-gray-400">
              {t("multiAgent.emptyDesc")}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default function MultiAgentPage() {
  return (
    <Suspense>
      <MultiAgentInner />
    </Suspense>
  );
}
