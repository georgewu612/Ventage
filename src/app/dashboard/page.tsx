"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  BookMarked,
  Brain,
  ChevronRight,
  DollarSign,
  Layers,
  MessageSquare,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

import { RegimeBadge } from "@/components/dashboard/RegimeBadge";
import { SignalCard } from "@/components/dashboard/SignalCard";
import { SignalDetail } from "@/components/dashboard/SignalDetail";
import { SlidePanel } from "@/components/ui/SlidePanel";
import { PLAN_LABELS } from "@/lib/features/gates";
import { useMarketRegime } from "@/lib/hooks/useMarketRegime";
import { useMarketSignals } from "@/lib/hooks/useMarketSignals";
import { useProfile } from "@/lib/hooks/useProfile";
import { useI18n } from "@/lib/i18n/provider";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// ── Types ──────────────────────────────────────────────────────────────────────

interface WatchlistItem {
  symbol: string;
  notes: string | null;
}

interface AlertHistoryItem {
  id: string;
  symbol: string;
  direction: string;
  signal_score: number;
  created_at: string;
}

interface StrategyRunItem {
  id: string;
  template_name: string;
  symbol: string;
  status: "pending" | "running" | "done" | "failed";
  created_at: string;
}

interface PortfolioSummary {
  total_value: number | null;
  total_pnl: number | null;
  position_count: number;
  top_position: string | null;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  href,
  linkLabel,
  iconColor = "text-cyan-400",
}: {
  icon: React.ElementType;
  title: string;
  href?: string;
  linkLabel?: string;
  iconColor?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white/90">
        <Icon className={`h-4 w-4 ${iconColor}`} />
        {title}
      </h2>
      {href && linkLabel && (
        <Link
          href={href}
          className="flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-cyan-400"
        >
          {linkLabel}
          <ChevronRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

function DataSourceShortcut({
  icon: Icon,
  label,
  href,
  color,
}: {
  icon: React.ElementType;
  label: string;
  href: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
    >
      <Icon className={`h-3.5 w-3.5 ${color}`} />
      {label}
    </Link>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { plan, can } = useProfile();

  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [alerts, setAlerts] = useState<AlertHistoryItem[]>([]);
  const [strategyRuns, setStrategyRuns] = useState<StrategyRunItem[]>([]);
  const [portfolioSummary, setPortfolioSummary] =
    useState<PortfolioSummary | null>(null);
  const [selectedSignal, setSelectedSignal] = useState<
    ReturnType<typeof useMarketSignals>["signals"][number] | null
  >(null);

  // ── Data hooks ─────────────────────────────────────────────────────
  const { regime, loading: regimeLoading } = useMarketRegime();

  const { signals, loading: signalsLoading } = useMarketSignals({
    minScore: 60,
    limit: 20,
  });

  // ── Load watchlist + alert history + strategy runs + portfolio ─────
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;

      const [wl, al, sr] = await Promise.all([
        supabase
          .from("watchlists")
          .select("symbol, notes")
          .eq("user_id", user.id)
          .order("added_at", { ascending: false })
          .limit(8),
        supabase
          .from("alert_history")
          .select("id, symbol, direction, signal_score, created_at")
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("strategy_runs")
          .select("id, template_name, symbol, status, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(3),
      ]);

      if (wl.data) setWatchlist(wl.data);
      if (al.data) setAlerts(al.data);
      if (sr.data) setStrategyRuns(sr.data as StrategyRunItem[]);

      // Portfolio summary from holdings table
      const holdings = await supabase
        .from("portfolio_holdings")
        .select("symbol, quantity, avg_cost")
        .eq("user_id", user.id)
        .limit(20);

      if (holdings.data && holdings.data.length > 0) {
        setPortfolioSummary({
          total_value: null, // live price not fetched here
          total_pnl: null,
          position_count: holdings.data.length,
          top_position: holdings.data[0]?.symbol ?? null,
        });
      }
    });
  }, []);

  // ── Derived signal buckets ──────────────────────────────────────────
  const bullishSignals = signals
    .filter((s) => s.direction === "bullish" && (s.signal_score ?? 0) >= 65)
    .slice(0, 5);

  const bearishSignals = signals
    .filter(
      (s) =>
        s.direction === "bearish" ||
        (s.direction === "neutral" && (s.signal_score ?? 0) >= 75),
    )
    .slice(0, 4);

  // ── Plan badge ─────────────────────────────────────────────────────
  const planInfo = PLAN_LABELS[plan as keyof typeof PLAN_LABELS];
  const planLabel = planInfo
    ? locale === "zh"
      ? planInfo.zh
      : planInfo.en
    : plan;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8">
        {/* ── Top: welcome + plan badge ── */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white">
            {t("home.marketPulse")}
          </h1>
          <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-400">
            {planLabel}
          </span>
        </div>

        {/* ════════════════════════════════════════════════════════
            SECTION 1: Market Pulse
        ════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeader
            icon={TrendingUp}
            title={t("home.marketPulse")}
            iconColor="text-cyan-400"
          />
          {regimeLoading ? (
            <div className="h-32 animate-pulse rounded-xl bg-white/5" />
          ) : regime ? (
            <RegimeBadge regime={regime} />
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
              <p className="text-sm text-slate-400">{t("regime.noData")}</p>
              <p className="mt-1 text-xs text-slate-500">
                {t("regime.noDataHint")}
              </p>
            </div>
          )}
        </section>

        {/* ════════════════════════════════════════════════════════
            SECTION 2 + 3: High Conviction | Risk Desk (side by side)
        ════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* ── High Conviction Setups ── */}
          <section>
            <SectionHeader
              icon={TrendingUp}
              title={t("home.highConviction")}
              href="/dashboard/signals"
              linkLabel={t("home.viewAll")}
              iconColor="text-emerald-400"
            />
            <div className="space-y-2">
              {signalsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-20 animate-pulse rounded-xl bg-white/5"
                  />
                ))
              ) : bullishSignals.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center text-sm text-slate-400">
                  {t("home.noConviction")}
                </div>
              ) : (
                bullishSignals.map((sig) => (
                  <div
                    key={sig.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedSignal(sig)}
                  >
                    <SignalCard
                      signal={sig}
                      onClick={() => setSelectedSignal(sig)}
                    />
                  </div>
                ))
              )}
            </div>
          </section>

          {/* ── Risk Desk ── */}
          <section>
            <SectionHeader
              icon={AlertTriangle}
              title={t("home.riskDesk")}
              href="/dashboard/signals"
              linkLabel={t("home.viewAll")}
              iconColor="text-red-400"
            />

            {/* VIX warning banner */}
            {regime && regime.volatility === "very_high" && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                VIX {regime.vix?.toFixed(1)} — elevated volatility regime
              </div>
            )}
            {regime && regime.volatility === "high" && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                VIX {regime.vix?.toFixed(1)} — high volatility, caution advised
              </div>
            )}

            <div className="space-y-2">
              {signalsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-20 animate-pulse rounded-xl bg-white/5"
                  />
                ))
              ) : bearishSignals.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center text-sm text-slate-400">
                  {t("home.noRisk")}
                </div>
              ) : (
                bearishSignals.map((sig) => (
                  <div
                    key={sig.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedSignal(sig)}
                  >
                    <SignalCard
                      signal={sig}
                      onClick={() => setSelectedSignal(sig)}
                    />
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* ════════════════════════════════════════════════════════
            SECTION 4: My Desk
        ════════════════════════════════════════════════════════ */}
        <section>
          <SectionHeader
            icon={BookMarked}
            title={t("home.myDesk")}
            iconColor="text-violet-400"
          />

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Watchlist */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <h3 className="mb-3 flex items-center justify-between text-xs font-semibold text-slate-400">
                  {t("home.watchlist")}
                  <Link
                    href="/dashboard/signals"
                    className="flex items-center gap-0.5 text-cyan-500 hover:text-cyan-400"
                  >
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </h3>
                {watchlist.length === 0 ? (
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">
                      {t("home.noWatchlist")}
                    </p>
                    <p className="text-xs text-slate-600">
                      {t("home.addToWatchlist")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {watchlist.map((w) => (
                      <Link
                        key={w.symbol}
                        href={`/dashboard/stocks/${w.symbol}`}
                        className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10"
                      >
                        <span className="font-semibold text-white">
                          {w.symbol}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Alerts */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <h3 className="mb-3 flex items-center justify-between text-xs font-semibold text-slate-400">
                  {t("home.recentAlerts")}
                  <Link
                    href="/dashboard/alerts"
                    className="flex items-center gap-0.5 text-cyan-500 hover:text-cyan-400"
                  >
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </h3>
                {alerts.length === 0 ? (
                  <p className="text-xs text-slate-500">{t("home.noAlerts")}</p>
                ) : (
                  <div className="space-y-1.5">
                    {alerts.map((al) => (
                      <Link
                        key={al.id}
                        href={`/dashboard/stocks/${al.symbol}`}
                        className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 transition-colors hover:bg-white/10"
                      >
                        <div className="flex items-center gap-2">
                          {al.direction === "bullish" ? (
                            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                          )}
                          <span className="text-sm font-semibold text-white">
                            {al.symbol}
                          </span>
                        </div>
                        <span className="text-xs text-slate-400">
                          {al.signal_score}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* Data source shortcuts */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <h3 className="mb-3 text-xs font-semibold text-slate-400">
                  Data Sources
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <DataSourceShortcut
                    icon={DollarSign}
                    label="Options"
                    href="/dashboard/options"
                    color="text-cyan-400"
                  />
                  <DataSourceShortcut
                    icon={Users}
                    label="Insider"
                    href="/dashboard/insider"
                    color="text-violet-400"
                  />
                  <DataSourceShortcut
                    icon={Layers}
                    label="Dark Pool"
                    href="/dashboard/darkpool"
                    color="text-amber-400"
                  />
                  <DataSourceShortcut
                    icon={MessageSquare}
                    label="Sentiment"
                    href="/dashboard/sentiment"
                    color="text-pink-400"
                  />
                  <DataSourceShortcut
                    icon={Brain}
                    label="Reports"
                    href="/dashboard/reports"
                    color="text-emerald-400"
                  />
                  <DataSourceShortcut
                    icon={Bell}
                    label="Alerts"
                    href="/dashboard/alerts"
                    color="text-orange-400"
                  />
                </div>
              </div>
            </div>

            {/* Strategy Status + Portfolio Risk row */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* Strategy Status */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <h3 className="mb-3 flex items-center justify-between text-xs font-semibold text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5 text-cyan-400" />
                    {t("home.strategyStatus")}
                  </span>
                  <Link
                    href="/dashboard/strategies"
                    className="flex items-center gap-0.5 text-cyan-500 hover:text-cyan-400"
                  >
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </h3>
                {strategyRuns.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    {t("home.noStrategies")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {strategyRuns.map((run) => {
                      const statusColor =
                        run.status === "done"
                          ? "text-emerald-400 bg-emerald-500/10"
                          : run.status === "running"
                            ? "text-cyan-400 bg-cyan-500/10"
                            : run.status === "failed"
                              ? "text-red-400 bg-red-500/10"
                              : "text-gray-400 bg-white/5";
                      return (
                        <Link
                          key={run.id}
                          href={`/dashboard/strategies/${run.id}`}
                          className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10"
                        >
                          <div>
                            <span className="font-semibold text-white">
                              {run.symbol}
                            </span>
                            <span className="ml-2 text-xs text-slate-400">
                              {run.template_name}
                            </span>
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusColor}`}
                          >
                            {run.status}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Portfolio Risk */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <h3 className="mb-3 flex items-center justify-between text-xs font-semibold text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <Wallet className="h-3.5 w-3.5 text-violet-400" />
                    {t("home.portfolioRisk")}
                  </span>
                  <Link
                    href="/dashboard/portfolio"
                    className="flex items-center gap-0.5 text-cyan-500 hover:text-cyan-400"
                  >
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </h3>
                {!portfolioSummary ? (
                  <p className="text-xs text-slate-500">
                    {t("home.noHoldings")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                      <span className="text-xs text-slate-400">
                        {t("home.positionCount")}
                      </span>
                      <span className="font-semibold text-white">
                        {portfolioSummary.position_count}
                      </span>
                    </div>
                    {portfolioSummary.top_position && (
                      <Link
                        href={`/dashboard/stocks/${portfolioSummary.top_position}`}
                        className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 transition-colors hover:bg-white/10"
                      >
                        <span className="text-xs text-slate-400">
                          {t("home.topPosition")}
                        </span>
                        <span className="font-semibold text-violet-300">
                          {portfolioSummary.top_position}
                        </span>
                      </Link>
                    )}
                    <Link
                      href="/dashboard/portfolio"
                      className="block rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-center text-xs text-violet-300 transition-colors hover:bg-violet-500/10"
                    >
                      {t("home.viewPortfolio")} →
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Signal detail panel */}
      <SlidePanel
        isOpen={!!selectedSignal}
        onClose={() => setSelectedSignal(null)}
      >
        {selectedSignal && <SignalDetail signal={selectedSignal} />}
      </SlidePanel>
    </div>
  );
}
