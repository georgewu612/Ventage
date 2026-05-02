"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  BookMarked,
  BookmarkPlus,
  Brain,
  ChevronDown,
  Loader2,
  TrendingDown,
  TrendingUp,
  User,
} from "lucide-react";

import { CandlestickChart } from "@/components/dashboard/CandlestickChart";
import { ActiveSignalsForSymbol } from "@/components/dashboard/ActiveSignalsForSymbol";
import { ChipStructureCard } from "@/components/dashboard/ChipStructureCard";
import { DCFCard } from "@/components/dashboard/DCFCard";
import { FactorProfileCard } from "@/components/dashboard/FactorProfileCard";
import { QualityScoreCard } from "@/components/dashboard/QualityScoreCard";
import { HistoricalAnalogCard } from "@/components/dashboard/HistoricalAnalogCard";
import { MonitoringTriggersCard } from "@/components/dashboard/MonitoringTriggersCard";
import { SymbolRegimeCard } from "@/components/dashboard/SymbolRegimeCard";
import { VMScoreCard } from "@/components/dashboard/VMScoreCard";
import { VolumeAnalysisCard } from "@/components/dashboard/VolumeAnalysisCard";
import {
  TechnicalLevelsCard,
  type TechnicalLevelsData,
} from "@/components/dashboard/TechnicalLevelsCard";
import type { SRLevel } from "@/components/dashboard/CandlestickChart";
import { API_BASE_URL } from "@/lib/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/provider";
import { useTechnicalAnalysis } from "@/lib/hooks/useTechnicalAnalysis";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Signal {
  id: string;
  symbol: string;
  direction: "bullish" | "bearish" | "neutral";
  signal_score: number;
  confidence: number;
  analysis: string | null;
  module?: string;
  created_at: string;
}

interface OptionsItem {
  id: string;
  symbol: string;
  option_type: "call" | "put";
  strike: number;
  expiration: string;
  premium: number;
  volume: number;
  unusual_score: number | null;
  trade_type: string | null;
}

interface InsiderItem {
  id: string;
  symbol: string;
  insider_name: string;
  insider_title: string | null;
  trade_type: "BUY" | "SELL";
  shares: number;
  value: number | null;
  filing_date: string;
}

interface DarkPoolItem {
  id: string;
  symbol: string;
  price: number;
  size: number;
  exchange: string | null;
  value: number | null;
  trade_time: string;
}

interface SentimentItem {
  id: string;
  symbol: string;
  source: string;
  sentiment_score: number | null;
  analysis_window: string | null;
  created_at: string;
}

interface AIAnalysis {
  decision?: string;
  fundamentals_report?: string;
  sentiment_report?: string;
  news_report?: string;
  technical_report?: string;
  bull_report?: string;
  bear_report?: string;
  risk_report?: string;
  trader_decision?: string;
  summary?: string;
  reasoning?: string;
  risk_assessment?: string;
  [key: string]: unknown;
}

interface StrategyFit {
  strategy_name: string;
  strategy_name_en: string;
  fit_score: number;
  reason: string;
  reason_en: string;
}

interface DeskConsensusData {
  symbol: string;
  conclusion: string;
  conclusion_en: string;
  final_action: string;
  conviction: "high" | "medium" | "low";
  time_horizon: string;
  risk_level: string;
  confidence_score: number;
  supporting_evidence: string[];
  supporting_evidence_en: string[];
  risk_evidence: string[];
  risk_evidence_en: string[];
  invalidation_conditions: string[];
  invalidation_conditions_en: string[];
  technical_desk: string;
  technical_desk_en: string;
  flow_desk: string;
  flow_desk_en: string;
  event_desk: string;
  event_desk_en: string;
  risk_desk: string;
  risk_desk_en: string;
  strategy_fit: StrategyFit[];
  generated_at: string;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(v: number | null, prefix = "$"): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1_000_000)
    return `${prefix}${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${prefix}${(v / 1_000).toFixed(0)}K`;
  return `${prefix}${v.toFixed(0)}`;
}

function hasChinese(s: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(s);
}

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
        if (typeof text === "string" && text.length > 0) {
          if (locale === "en" && hasChinese(text) && !/[a-zA-Z]{3}/.test(text))
            return "";
          return text;
        }
      }
    } catch {
      // fall through
    }
  }
  if (locale === "en" && hasChinese(trimmed) && !/[a-zA-Z]{3}/.test(trimmed))
    return "";
  return trimmed;
}

// ── Small sub-components ──────────────────────────────────────────────────────

function DirectionBadge({ dir }: { dir: string }) {
  const { t } = useI18n();
  const cfg =
    dir === "bullish"
      ? {
          cls: "bg-emerald-500/15 text-emerald-400",
          icon: <TrendingUp className="h-3 w-3" />,
        }
      : dir === "bearish"
        ? {
            cls: "bg-red-500/15 text-red-400",
            icon: <TrendingDown className="h-3 w-3" />,
          }
        : { cls: "bg-gray-500/15 text-gray-400", icon: null };
  const label =
    dir === "bullish"
      ? t("signal.bullish")
      : dir === "bearish"
        ? t("signal.bearish")
        : t("signal.neutral");
  return (
    <span
      className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.cls}`}
    >
      {cfg.icon}
      {label}
    </span>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="mb-3 text-xs font-semibold tracking-wider text-gray-400 uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="py-4 text-center text-sm text-gray-500">{text}</p>;
}

// ── Desk Consensus Card ───────────────────────────────────────────────────────

const ACTION_CONFIG: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  strong_buy: {
    label: "Strong Buy",
    bg: "bg-emerald-500/20",
    text: "text-emerald-300",
  },
  buy: { label: "Buy", bg: "bg-emerald-500/15", text: "text-emerald-400" },
  hold: { label: "Hold", bg: "bg-yellow-500/15", text: "text-yellow-400" },
  watch: { label: "Watch", bg: "bg-cyan-500/15", text: "text-cyan-400" },
  sell: { label: "Sell", bg: "bg-red-500/15", text: "text-red-400" },
  strong_sell: {
    label: "Strong Sell",
    bg: "bg-red-500/20",
    text: "text-red-300",
  },
  avoid: { label: "Avoid", bg: "bg-gray-500/15", text: "text-gray-400" },
};

const CONVICTION_COLOR: Record<string, string> = {
  high: "text-emerald-400",
  medium: "text-yellow-400",
  low: "text-gray-400",
};

function DeskConsensusCard({
  desk,
  loading,
  error,
  onRefresh,
  locale,
}: {
  desk: DeskConsensusData | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  locale: string;
}) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="space-y-2 rounded-xl border border-violet-500/20 bg-violet-500/5 p-6 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-violet-400" />
        <p className="text-sm text-violet-300">{t("desk.loading")}</p>
        <p className="text-xs text-slate-500">{t("desk.loadingNote")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/5 p-4">
        <span className="text-sm text-red-400">
          {t("desk.failed")}: {error}
        </span>
        <button
          onClick={onRefresh}
          className="ml-3 text-xs text-slate-400 hover:text-white"
        >
          {t("desk.refresh")}
        </button>
      </div>
    );
  }

  if (!desk) return null;

  const actionCfg = ACTION_CONFIG[desk.final_action] ?? {
    label: desk.final_action,
    bg: "bg-slate-500/15",
    text: "text-slate-300",
  };
  const conclusion =
    locale === "zh" ? desk.conclusion : desk.conclusion_en || desk.conclusion;

  const desks = [
    {
      key: "technical",
      label: t("desk.technicalDesk"),
      color: "text-cyan-400",
      text: locale === "zh" ? desk.technical_desk : desk.technical_desk_en,
    },
    {
      key: "flow",
      label: t("desk.flowDesk"),
      color: "text-violet-400",
      text: locale === "zh" ? desk.flow_desk : desk.flow_desk_en,
    },
    {
      key: "event",
      label: t("desk.eventDesk"),
      color: "text-amber-400",
      text: locale === "zh" ? desk.event_desk : desk.event_desk_en,
    },
    {
      key: "risk",
      label: t("desk.riskDesk"),
      color: "text-red-400",
      text: locale === "zh" ? desk.risk_desk : desk.risk_desk_en,
    },
  ];

  return (
    <div className="space-y-4 rounded-xl border border-violet-500/25 bg-violet-500/5 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wider text-violet-300/70 uppercase">
            {t("desk.title")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-lg px-3 py-1 text-sm font-bold ${actionCfg.bg} ${actionCfg.text}`}
            >
              {actionCfg.label}
            </span>
            <span
              className={`text-xs font-semibold ${CONVICTION_COLOR[desk.conviction]}`}
            >
              {t("desk.conviction")}: {desk.conviction}
            </span>
            <span className="text-xs text-slate-400">
              {t("desk.timeHorizon")}: {desk.time_horizon}
            </span>
            <span className="text-xs text-slate-400">
              {t("desk.confidence")}: {Math.round(desk.confidence_score)}%
            </span>
          </div>
        </div>
        <button
          onClick={onRefresh}
          className="shrink-0 text-xs text-slate-500 transition-colors hover:text-violet-300"
        >
          {t("desk.refresh")}
        </button>
      </div>

      {/* Conclusion */}
      <p className="text-sm leading-relaxed text-slate-200">{conclusion}</p>

      {/* Four desk panels */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {desks.map((d) => (
          <details
            key={d.key}
            className="group rounded-lg border border-white/10 bg-white/5"
          >
            <summary
              className={`flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold ${d.color}`}
            >
              {d.label}
              <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-white/10 px-3 py-2 text-xs leading-relaxed text-slate-300">
              {d.text}
            </div>
          </details>
        ))}
      </div>

      {/* Strategy fit */}
      {desk.strategy_fit.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold text-slate-400">
            {t("desk.strategyFit")}
          </p>
          <div className="space-y-2">
            {desk.strategy_fit.map((sf) => (
              <div
                key={sf.strategy_name_en}
                className="rounded-lg bg-white/5 px-3 py-2"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">
                    {locale === "zh" ? sf.strategy_name : sf.strategy_name_en}
                  </span>
                  <span className="text-xs font-bold text-violet-300">
                    {Math.round(sf.fit_score)}
                  </span>
                </div>
                <div className="mb-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-violet-500 transition-all"
                    style={{ width: `${sf.fit_score}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-400">
                  {locale === "zh" ? sf.reason : sf.reason_en}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evidence + invalidation */}
      {(() => {
        const zh = locale === "zh";
        const evidence = zh
          ? desk.supporting_evidence
          : desk.supporting_evidence_en?.length
            ? desk.supporting_evidence_en
            : desk.supporting_evidence;
        const risks = zh
          ? desk.risk_evidence
          : desk.risk_evidence_en?.length
            ? desk.risk_evidence_en
            : desk.risk_evidence;
        const conditions = zh
          ? desk.invalidation_conditions
          : desk.invalidation_conditions_en?.length
            ? desk.invalidation_conditions_en
            : desk.invalidation_conditions;
        return (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {evidence.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold text-emerald-400/80 uppercase">
                  {t("desk.supportingEvidence")}
                </p>
                <ul className="space-y-1">
                  {evidence.map((e, i) => (
                    <li
                      key={i}
                      className="flex gap-1 text-[10px] text-slate-300"
                    >
                      <span className="mt-0.5 text-emerald-500">•</span>
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {risks.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold text-red-400/80 uppercase">
                  {t("desk.riskEvidence")}
                </p>
                <ul className="space-y-1">
                  {risks.map((e, i) => (
                    <li
                      key={i}
                      className="flex gap-1 text-[10px] text-slate-300"
                    >
                      <span className="mt-0.5 text-red-500">•</span>
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {conditions.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold text-orange-400/80 uppercase">
                  {t("desk.invalidation")}
                </p>
                <ul className="space-y-1">
                  {conditions.map((e, i) => (
                    <li
                      key={i}
                      className="flex gap-1 text-[10px] text-slate-300"
                    >
                      <span className="mt-0.5 text-orange-500">•</span>
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── Price Bar ─────────────────────────────────────────────────────────────────

function PriceBar({ symbol }: { symbol: string }) {
  const { data } = useTechnicalAnalysis(symbol, "1m", "1d");
  if (!data?.latest) return null;
  const { price, change_pct, rsi, volume } = data.latest;
  const isUp = (change_pct ?? 0) >= 0;
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <span
        className={`text-2xl font-bold tabular-nums ${isUp ? "text-emerald-400" : "text-red-400"}`}
      >
        {price != null ? `$${price.toFixed(2)}` : "—"}
      </span>
      <span
        className={`rounded-full px-2 py-0.5 text-sm font-semibold ${isUp ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}
      >
        {isUp ? "+" : ""}
        {change_pct?.toFixed(2)}%
      </span>
      {rsi != null && (
        <span className="text-xs text-gray-400">
          RSI{" "}
          <span
            className={`font-semibold ${rsi > 70 ? "text-red-300" : rsi < 30 ? "text-emerald-300" : "text-gray-200"}`}
          >
            {rsi.toFixed(0)}
          </span>
        </span>
      )}
      {volume > 0 && (
        <span className="text-xs text-gray-400">
          Vol{" "}
          <span className="font-semibold text-gray-200">{fmt(volume, "")}</span>
        </span>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function StockWorkbenchInner() {
  const params = useParams();
  const router = useRouter();
  const symbol = ((params.symbol as string) ?? "").toUpperCase();
  const { t, locale, dateLocale } = useI18n();

  // Watchlist state
  const [inWatchlist, setInWatchlist] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase
        .from("watchlists")
        .select("id")
        .eq("user_id", user.id)
        .eq("symbol", symbol)
        .maybeSingle();
      setInWatchlist(!!data);
    });
  }, [symbol]);

  const toggleWatchlist = async () => {
    setWatchlistLoading(true);
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    if (inWatchlist) {
      await supabase
        .from("watchlists")
        .delete()
        .eq("user_id", user.id)
        .eq("symbol", symbol);
      setInWatchlist(false);
    } else {
      await supabase.from("watchlists").insert({ user_id: user.id, symbol });
      setInWatchlist(true);
    }
    setWatchlistLoading(false);
  };

  // Data fetching
  const [signals, setSignals] = useState<Signal[]>([]);
  const [options, setOptions] = useState<OptionsItem[]>([]);
  const [insiders, setInsiders] = useState<InsiderItem[]>([]);
  const [darkpool, setDarkpool] = useState<DarkPoolItem[]>([]);
  const [sentiment, setSentiment] = useState<SentimentItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!symbol) return;
    setDataLoading(true);
    Promise.allSettled([
      fetch(`${API_BASE_URL}/v1/signals?symbol=${symbol}&limit=8`).then((r) =>
        r.json(),
      ),
      fetch(`${API_BASE_URL}/v1/options-flow?symbol=${symbol}&limit=6`).then(
        (r) => r.json(),
      ),
      fetch(`${API_BASE_URL}/v1/insider-trades?symbol=${symbol}&limit=6`).then(
        (r) => r.json(),
      ),
      fetch(
        `${API_BASE_URL}/v1/dark-pool-orders?symbol=${symbol}&limit=5`,
      ).then((r) => r.json()),
      fetch(
        `${API_BASE_URL}/v1/market-sentiment?symbol=${symbol}&limit=3`,
      ).then((r) => r.json()),
    ]).then(([sig, opt, ins, dp, sent]) => {
      if (sig.status === "fulfilled") setSignals(sig.value?.items ?? []);
      if (opt.status === "fulfilled") setOptions(opt.value?.items ?? []);
      if (ins.status === "fulfilled") setInsiders(ins.value?.items ?? []);
      if (dp.status === "fulfilled") setDarkpool(dp.value?.items ?? []);
      if (sent.status === "fulfilled") setSentiment(sent.value?.items ?? []);
      setDataLoading(false);
    });
  }, [symbol]);

  // Desk Consensus (auto-fetched on load)
  const [deskLoading, setDeskLoading] = useState(false);
  const [deskResult, setDeskResult] = useState<DeskConsensusData | null>(null);
  const [deskError, setDeskError] = useState<string | null>(null);

  const fetchDesk = useCallback(async () => {
    if (!symbol) return;
    setDeskLoading(true);
    setDeskError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/reports/desk/${symbol}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      setDeskResult(data);
    } catch (e) {
      setDeskError((e as Error).message);
    } finally {
      setDeskLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchDesk();
  }, [fetchDesk]);

  // AI Analysis
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AIAnalysis | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // S/R levels from TechnicalLevelsCard — fed into CandlestickChart
  const [srSupport, setSrSupport] = useState<SRLevel[]>([]);
  const [srResist, setSrResist] = useState<SRLevel[]>([]);
  const handleLevelsLoaded = useCallback((d: TechnicalLevelsData) => {
    // Show nearest 3 support + 3 resistance levels regardless of distance.
    // The chart draws them with axisLabelVisible=false to avoid Y-axis stretching.
    setSrSupport(d.support_levels.slice(0, 3));
    setSrResist(d.resist_levels.slice(0, 3));
  }, []);

  const runAiAnalysis = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const lang = locale === "zh" ? "zh" : "en";
      const res = await fetch(
        `${API_BASE_URL}/v1/reports/multi-agent/${symbol}?language=${lang}`,
        { signal: abortRef.current.signal },
      );
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      setAiResult(data);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setAiError((e as Error).message);
    } finally {
      setAiLoading(false);
    }
  }, [symbol, locale]);

  // Technical chart — period/interval controlled by user selection
  const [chartPeriod, setChartPeriod] = useState("6m");
  const [chartInterval, setChartInterval] = useState("1d");
  const { data: techData, loading: techLoading } = useTechnicalAnalysis(
    symbol,
    chartPeriod,
    chartInterval,
  );

  // Agent report config
  const agentReports = [
    {
      key: "fundamentals_report",
      label: t("stock.fundamentals"),
      color: "text-blue-400",
    },
    {
      key: "technical_report",
      label: t("stock.technical"),
      color: "text-cyan-400",
    },
    {
      key: "sentiment_report",
      label: t("stock.sentimentReport"),
      color: "text-pink-400",
    },
    {
      key: "news_report",
      label: t("stock.newsReport"),
      color: "text-amber-400",
    },
    {
      key: "bull_report",
      label: t("stock.bullCase"),
      color: "text-emerald-400",
    },
    {
      key: "bear_report",
      label: t("stock.bearCase"),
      color: "text-red-400",
    },
    {
      key: "risk_report",
      label: t("stock.riskAssessment"),
      color: "text-orange-400",
    },
  ];

  if (!symbol) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-500">
        {t("stock.enterSymbol")}
      </div>
    );
  }

  return (
    <div>
      {/* ── Compact Header ── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-white/5 px-6 py-3">
        <button
          onClick={() => router.back()}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <span className="text-xl font-bold text-white">${symbol}</span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggleWatchlist}
            disabled={watchlistLoading}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all ${
              inWatchlist
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                : "border-white/10 bg-white/5 text-gray-400 hover:border-white/20 hover:text-white"
            }`}
          >
            {inWatchlist ? (
              <BookMarked className="h-4 w-4" />
            ) : (
              <BookmarkPlus className="h-4 w-4" />
            )}
            {inWatchlist ? t("stock.watchlistAdded") : t("stock.watchlistAdd")}
          </button>

          <button
            onClick={runAiAnalysis}
            disabled={aiLoading}
            className="flex items-center gap-1.5 rounded-lg bg-purple-500/20 px-3 py-1.5 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/30 disabled:opacity-50"
          >
            {aiLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Brain className="h-4 w-4" />
            )}
            {aiLoading ? t("stock.aiAnalyzing") : t("stock.aiAnalysis")}
          </button>
        </div>
      </div>

      <main className="container mx-auto space-y-4 px-6 py-5">
        {/* Price bar */}
        <PriceBar symbol={symbol} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* ── Left / Center (2 cols): Chart + data panels ── */}
          <div className="space-y-4 xl:col-span-2">
            {/* K-line chart */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              {/* Chart header: title + period/interval selectors */}
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold tracking-wider text-gray-400 uppercase">
                  {t("stock.chartTitle")} &mdash; {symbol}
                </p>
                <div className="flex items-center gap-1">
                  {/* Period selector */}
                  {(
                    [
                      { p: "1m", i: "1d", label: "1M" },
                      { p: "3m", i: "1d", label: "3M" },
                      { p: "6m", i: "1d", label: "6M" },
                      { p: "1y", i: "1d", label: "1Y" },
                      { p: "2y", i: "1d", label: "2Y" },
                      { p: "5d", i: "1h", label: "5D" },
                      { p: "1d", i: "5min", label: "1D" },
                    ] as { p: string; i: string; label: string }[]
                  ).map(({ p, i, label }) => {
                    const active = chartPeriod === p && chartInterval === i;
                    return (
                      <button
                        key={label}
                        onClick={() => {
                          setChartPeriod(p);
                          setChartInterval(i);
                        }}
                        className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                          active
                            ? "bg-cyan-500 text-white"
                            : "text-gray-500 hover:bg-white/10 hover:text-gray-300"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {techLoading ? (
                <div className="flex h-52 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                </div>
              ) : techData ? (
                <CandlestickChart
                  data={techData}
                  supportLevels={srSupport}
                  resistLevels={srResist}
                />
              ) : (
                <div className="flex h-52 items-center justify-center text-sm text-gray-500">
                  {t("stock.noTechData")}
                </div>
              )}
            </div>

            {/* Technical Levels — S/R + Patterns + AI Bias */}
            <TechnicalLevelsCard
              symbol={symbol}
              onDataLoaded={handleLevelsLoaded}
            />

            {/* Desk Consensus */}
            <DeskConsensusCard
              desk={deskResult}
              loading={deskLoading}
              error={deskError}
              onRefresh={fetchDesk}
              locale={locale}
            />

            {/* ── Trading System v2 — 3 引擎演示 ───────────────────────── */}
            <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 via-transparent to-purple-500/5 p-1">
              <div className="mb-2 flex items-center gap-2 px-4 pt-3">
                <span className="rounded-md bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold tracking-wider text-cyan-300 uppercase">
                  Trading System v2
                </span>
                <span className="text-xs text-gray-500">
                  {locale === "zh"
                    ? "六维度协同：状态 / 量能 / 筹码"
                    : "Six-dim engine: Regime / Volume / Chip"}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 p-2 lg:grid-cols-3">
                <SymbolRegimeCard symbol={symbol} />
                <VolumeAnalysisCard symbol={symbol} />
                <ChipStructureCard symbol={symbol} />
              </div>
            </div>

            {/* ── Active rule-based signals (4-strategy scan) ─────────── */}
            <ActiveSignalsForSymbol symbol={symbol} />

            {/* DCF Valuation (fundamental view) */}
            <DCFCard symbol={symbol} />

            {/* Quality Score (Piotroski F-Score) */}
            <QualityScoreCard symbol={symbol} />

            {/* Factor Profile (6-dim style radar) */}
            <FactorProfileCard symbol={symbol} />

            {/* Historical Analog */}
            <HistoricalAnalogCard symbol={symbol} />

            {/* Monitoring Triggers */}
            <MonitoringTriggersCard
              conditions={deskResult?.invalidation_conditions}
              conditionsEn={
                deskResult?.invalidation_conditions_en?.length
                  ? deskResult.invalidation_conditions_en
                  : deskResult?.invalidation_conditions
              }
              loading={deskLoading}
            />

            {/* Options + Insider */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <SectionCard title={t("stock.optionsFlow")}>
                {options.length === 0 ? (
                  <EmptyRow text={t("stock.noOptions")} />
                ) : (
                  <div className="space-y-2">
                    {options.slice(0, 5).map((o) => (
                      <div
                        key={o.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              o.option_type === "call"
                                ? "bg-emerald-500/15 text-emerald-400"
                                : "bg-red-500/15 text-red-400"
                            }`}
                          >
                            {o.option_type.toUpperCase()}
                          </span>
                          <span className="text-gray-300">
                            ${o.strike} · {o.expiration?.slice(0, 10)}
                          </span>
                        </div>
                        <span className="font-semibold text-white tabular-nums">
                          {fmt(o.premium)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <a
                  href={`/dashboard/options?symbol=${symbol}`}
                  className="mt-3 flex items-center gap-1 text-xs text-cyan-400 hover:underline"
                >
                  {t("stock.viewAll")} <ArrowUpRight className="h-3 w-3" />
                </a>
              </SectionCard>

              <SectionCard title={t("stock.insiderTrades")}>
                {insiders.length === 0 ? (
                  <EmptyRow text={t("stock.noInsider")} />
                ) : (
                  <div className="space-y-2">
                    {insiders.slice(0, 5).map((ins) => (
                      <div
                        key={ins.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              ins.trade_type === "BUY"
                                ? "bg-emerald-500/15 text-emerald-400"
                                : "bg-red-500/15 text-red-400"
                            }`}
                          >
                            {ins.trade_type}
                          </span>
                          <div className="flex items-center gap-1 text-gray-300">
                            <User className="h-3 w-3 text-gray-500" />
                            <span className="max-w-[100px] truncate">
                              {ins.insider_name}
                            </span>
                          </div>
                        </div>
                        <span className="font-semibold text-white tabular-nums">
                          {fmt(ins.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <a
                  href={`/dashboard/insider?symbol=${symbol}`}
                  className="mt-3 flex items-center gap-1 text-xs text-cyan-400 hover:underline"
                >
                  {t("stock.viewAll")} <ArrowUpRight className="h-3 w-3" />
                </a>
              </SectionCard>
            </div>

            {/* Dark Pool + Sentiment */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <SectionCard title={t("stock.darkPool")}>
                {darkpool.length === 0 ? (
                  <EmptyRow text={t("stock.noDarkPool")} />
                ) : (
                  <div className="space-y-2">
                    {darkpool.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <div className="text-gray-300">
                          <span className="text-xs text-gray-500">
                            {d.exchange ?? "OTC"} ·{" "}
                          </span>
                          ${d.price.toFixed(2)} × {d.size.toLocaleString()}
                        </div>
                        <span className="font-semibold text-purple-300 tabular-nums">
                          {fmt(d.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <a
                  href={`/dashboard/darkpool?symbol=${symbol}`}
                  className="mt-3 flex items-center gap-1 text-xs text-cyan-400 hover:underline"
                >
                  {t("stock.viewAll")} <ArrowUpRight className="h-3 w-3" />
                </a>
              </SectionCard>

              <SectionCard title={t("stock.marketSentiment")}>
                {sentiment.length === 0 ? (
                  <EmptyRow text={t("stock.noSentiment")} />
                ) : (
                  <div className="space-y-3">
                    {sentiment.map((s) => {
                      const score = s.sentiment_score ?? 0;
                      const pct = Math.round((score + 1) * 50);
                      const color =
                        score > 0.3
                          ? "bg-emerald-500"
                          : score < -0.3
                            ? "bg-red-500"
                            : "bg-yellow-500";
                      return (
                        <div key={s.id}>
                          <div className="mb-1 flex justify-between text-xs text-gray-400">
                            <span>{s.source}</span>
                            <span
                              className={
                                score > 0.3
                                  ? "text-emerald-400"
                                  : score < -0.3
                                    ? "text-red-400"
                                    : "text-yellow-400"
                              }
                            >
                              {(score * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className={`h-full transition-all ${color}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <a
                  href={`/dashboard/sentiment?symbol=${symbol}`}
                  className="mt-3 flex items-center gap-1 text-xs text-cyan-400 hover:underline"
                >
                  {t("stock.viewAll")} <ArrowUpRight className="h-3 w-3" />
                </a>
              </SectionCard>
            </div>
          </div>

          {/* ── Right col: V&M Score + Signals + AI ── */}
          <div className="space-y-4">
            {/* V&M Score — visible without scrolling */}
            <VMScoreCard symbol={symbol} />

            {/* Signals Feed */}
            <SectionCard title={`${t("stock.signals")} · ${symbol}`}>
              {dataLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
                </div>
              ) : signals.length === 0 ? (
                <EmptyRow text={t("stock.noSignals")} />
              ) : (
                <div className="space-y-2">
                  {signals.map((sig) => (
                    <div
                      key={sig.id}
                      className="rounded-lg border border-white/5 bg-white/5 p-2.5"
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <DirectionBadge dir={sig.direction} />
                        <span className="text-xs font-semibold text-gray-300 tabular-nums">
                          {sig.signal_score ??
                            Math.round((sig.confidence ?? 0) * 100)}
                        </span>
                      </div>
                      {sig.analysis &&
                        (() => {
                          const text = parseAnalysis(sig.analysis, locale);
                          return text ? (
                            <p className="line-clamp-2 text-xs text-gray-200">
                              {text}
                            </p>
                          ) : null;
                        })()}
                      <p className="mt-1 text-[10px] text-gray-400">
                        {new Date(sig.created_at).toLocaleDateString(
                          dateLocale,
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* AI Analysis Panel */}
            <SectionCard title={t("stock.aiAnalysis")}>
              {!aiLoading && !aiResult && !aiError && (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <Brain className="h-10 w-10 text-purple-400/40" />
                  <p className="text-sm text-gray-500">
                    {t("stock.aiAgentCount")}
                  </p>
                  <p className="text-xs text-gray-600">
                    {t("stock.aiAgentTypes")}
                  </p>
                  <button
                    onClick={runAiAnalysis}
                    className="w-full rounded-xl bg-purple-500/20 py-2.5 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/30"
                  >
                    {t("stock.startAnalysis")}
                  </button>
                  <p className="text-[10px] text-gray-600">
                    {t("stock.aiCostNote")}
                  </p>
                </div>
              )}

              {aiLoading && (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <Loader2 className="h-7 w-7 animate-spin text-purple-400" />
                  <p className="text-sm text-gray-400">
                    {t("stock.aiRunning")}
                  </p>
                  <p className="text-xs text-gray-600">
                    {t("stock.aiRunningNote")}
                  </p>
                </div>
              )}

              {aiError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
                  {t("stock.aiFailed")}
                  {aiError}
                </div>
              )}

              {aiResult && (
                <div className="space-y-2 text-sm">
                  {/* Trading decision — always at top */}
                  {(aiResult.decision || aiResult.trader_decision) && (
                    <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-3">
                      <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-purple-300 uppercase">
                        {t("stock.traderDecision")}
                      </p>
                      <p className="text-xs leading-relaxed text-gray-200">
                        {String(aiResult.trader_decision ?? aiResult.decision)}
                      </p>
                    </div>
                  )}

                  {/* Agent report collapsibles */}
                  {agentReports
                    .filter(({ key }) => aiResult[key])
                    .map(({ key, label, color }) => (
                      <details
                        key={key}
                        className="group rounded-lg border border-white/10 bg-white/5"
                      >
                        <summary
                          className={`flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold ${color}`}
                        >
                          {label}
                          <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="border-t border-white/10 px-3 py-2.5 text-xs leading-relaxed text-gray-300">
                          {String(aiResult[key])}
                        </div>
                      </details>
                    ))}

                  <button
                    onClick={runAiAnalysis}
                    className="mt-1 w-full rounded-lg border border-white/10 py-1.5 text-xs text-gray-500 hover:text-gray-300"
                  >
                    {t("stock.reanalyze")}
                  </button>
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function StockWorkbenchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
        </div>
      }
    >
      <StockWorkbenchInner />
    </Suspense>
  );
}
