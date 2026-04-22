"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  BookMarked,
  BookmarkPlus,
  Brain,
  Loader2,
  Search,
  TrendingDown,
  TrendingUp,
  User,
} from "lucide-react";

import { CandlestickChart } from "@/components/dashboard/CandlestickChart";
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
  summary?: string;
  reasoning?: string;
  risk_assessment?: string;
  [key: string]: unknown;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(v: number | null, prefix = "$"): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1_000_000)
    return `${prefix}${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${prefix}${(v / 1_000).toFixed(0)}K`;
  return `${prefix}${v.toFixed(0)}`;
}

// ── Small sub-components ──────────────────────────────────────────────────────

function DirectionBadge({ dir }: { dir: string }) {
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
  return (
    <span
      className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.cls}`}
    >
      {cfg.icon}
      {dir === "bullish" ? "看涨" : dir === "bearish" ? "看跌" : "中性"}
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
          <span className="font-semibold text-gray-200">{rsi.toFixed(0)}</span>
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
  const { dateLocale } = useI18n();

  // Search box
  const [searchInput, setSearchInput] = useState(symbol);
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const s = searchInput.trim().toUpperCase();
    if (s) router.push(`/dashboard/stocks/${s}`);
  };

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

  // Data fetch helpers
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

  // AI Analysis
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AIAnalysis | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runAiAnalysis = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/v1/reports/multi-agent/${symbol}?language=zh`,
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
  }, [symbol]);

  // Technical chart
  const { data: techData, loading: techLoading } = useTechnicalAnalysis(
    symbol,
    "3m",
    "1d",
  );

  if (!symbol) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-500">
        请输入股票代码
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => router.back()}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            {/* Symbol */}
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-white">${symbol}</span>
            </div>

            {/* Search */}
            <form onSubmit={handleSearch} className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
                  placeholder="跳转到..."
                  className="w-28 rounded-lg border border-white/10 bg-slate-900/70 py-1.5 pr-3 pl-8 text-sm text-white placeholder:text-gray-500"
                />
              </div>
              <button
                type="submit"
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10"
              >
                跳转
              </button>
            </form>

            <div className="ml-auto flex items-center gap-2">
              {/* Watchlist toggle */}
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
                {inWatchlist ? "已自选" : "加自选"}
              </button>

              {/* AI Analyze */}
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
                {aiLoading ? "分析中..." : "AI 深度分析"}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto space-y-4 px-6 py-6">
        {/* Price bar */}
        <PriceBar symbol={symbol} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* ── Left col (2/3): Chart + data panels ── */}
          <div className="space-y-4 lg:col-span-2">
            {/* K-line chart */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="mb-3 text-xs font-semibold tracking-wider text-gray-400 uppercase">
                K 线图 — {symbol}
              </p>
              {techLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                </div>
              ) : techData ? (
                <CandlestickChart data={techData} />
              ) : (
                <div className="flex h-48 items-center justify-center text-sm text-gray-500">
                  暂无技术数据
                </div>
              )}
            </div>

            {/* Options + Insider grid */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Options Flow */}
              <SectionCard title="期权异动">
                {options.length === 0 ? (
                  <EmptyRow text="暂无期权数据" />
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
                  查看全部 <ArrowUpRight className="h-3 w-3" />
                </a>
              </SectionCard>

              {/* Insider Trades */}
              <SectionCard title="内部交易">
                {insiders.length === 0 ? (
                  <EmptyRow text="暂无内部交易" />
                ) : (
                  <div className="space-y-2">
                    {insiders.slice(0, 5).map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              t.trade_type === "BUY"
                                ? "bg-emerald-500/15 text-emerald-400"
                                : "bg-red-500/15 text-red-400"
                            }`}
                          >
                            {t.trade_type}
                          </span>
                          <div className="flex items-center gap-1 text-gray-300">
                            <User className="h-3 w-3 text-gray-500" />
                            <span className="max-w-[100px] truncate">
                              {t.insider_name}
                            </span>
                          </div>
                        </div>
                        <span className="font-semibold text-white tabular-nums">
                          {fmt(t.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <a
                  href={`/dashboard/insider?symbol=${symbol}`}
                  className="mt-3 flex items-center gap-1 text-xs text-cyan-400 hover:underline"
                >
                  查看全部 <ArrowUpRight className="h-3 w-3" />
                </a>
              </SectionCard>
            </div>

            {/* Dark Pool + Sentiment grid */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Dark Pool */}
              <SectionCard title="暗池大单">
                {darkpool.length === 0 ? (
                  <EmptyRow text="暂无暗池数据" />
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
                  查看全部 <ArrowUpRight className="h-3 w-3" />
                </a>
              </SectionCard>

              {/* Sentiment */}
              <SectionCard title="市场情绪">
                {sentiment.length === 0 ? (
                  <EmptyRow text="暂无情绪数据" />
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
                              className={`h-full ${color}`}
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
                  查看全部 <ArrowUpRight className="h-3 w-3" />
                </a>
              </SectionCard>
            </div>
          </div>

          {/* ── Right col (1/3): Signals + AI Analysis ── */}
          <div className="space-y-4">
            {/* Signals Feed */}
            <SectionCard title={`信号 · ${symbol}`}>
              {dataLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
                </div>
              ) : signals.length === 0 ? (
                <EmptyRow text="暂无信号" />
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
                      {sig.analysis && (
                        <p className="line-clamp-2 text-xs text-gray-400">
                          {sig.analysis}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-gray-600">
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
            <SectionCard title="AI 深度分析">
              {!aiLoading && !aiResult && !aiError && (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <Brain className="h-8 w-8 text-purple-400/50" />
                  <p className="text-sm text-gray-500">
                    7 个专业 AI Agent 协作分析
                  </p>
                  <button
                    onClick={runAiAnalysis}
                    className="w-full rounded-lg bg-purple-500/20 py-2 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/30"
                  >
                    启动深度分析
                  </button>
                  <p className="text-[10px] text-gray-600">
                    约消耗 $0.05–0.10 API 费用
                  </p>
                </div>
              )}

              {aiLoading && (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
                  <p className="text-sm text-gray-400">多 Agent 协作分析中…</p>
                  <p className="text-xs text-gray-600">通常需要 30–60 秒</p>
                </div>
              )}

              {aiError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
                  分析失败：{aiError}
                </div>
              )}

              {aiResult && (
                <div className="space-y-3 text-sm">
                  {aiResult.decision && (
                    <div className="rounded-lg border border-purple-500/20 bg-purple-500/10 p-3">
                      <p className="mb-1 text-xs font-semibold text-purple-300">
                        交易决策
                      </p>
                      <p className="text-gray-200">
                        {String(aiResult.decision)}
                      </p>
                    </div>
                  )}
                  {aiResult.summary && (
                    <div>
                      <p className="mb-1 text-xs font-semibold text-gray-400">
                        分析摘要
                      </p>
                      <p className="text-xs leading-relaxed text-gray-300">
                        {String(aiResult.summary)}
                      </p>
                    </div>
                  )}
                  {aiResult.risk_assessment && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
                      <p className="mb-1 text-xs font-semibold text-amber-400">
                        风险评估
                      </p>
                      <p className="text-xs text-gray-300">
                        {String(aiResult.risk_assessment)}
                      </p>
                    </div>
                  )}
                  <button
                    onClick={runAiAnalysis}
                    className="w-full rounded-lg border border-white/10 py-1.5 text-xs text-gray-400 hover:bg-white/5"
                  >
                    重新分析
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
    <Suspense>
      <StockWorkbenchInner />
    </Suspense>
  );
}
