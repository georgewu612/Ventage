"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Brain,
  DollarSign,
  Layers,
  MessageSquare,
  TrendingUp,
  Users,
} from "lucide-react";

import {
  SignalCard,
  SignalCardSkeleton,
} from "@/components/dashboard/SignalCard";
import { SignalDetail } from "@/components/dashboard/SignalDetail";
import { SlidePanel } from "@/components/ui/SlidePanel";
import { ToastContainer, ToastItem } from "@/components/ui/Toast";
import { PLAN_LABELS } from "@/lib/features/gates";
import { useProfile } from "@/lib/hooks/useProfile";
import { useMarketSignals } from "@/lib/hooks/useMarketSignals";
import { useI18n } from "@/lib/i18n/provider";

const MODULE_OPTIONS = [
  "",
  "options_flow",
  "insider_trades",
  "market_sentiment",
  "dark_pool",
];

function StatCard({
  label,
  value,
  color = "text-white",
  border = "border-white/10",
  bg = "bg-white/5",
}: {
  label: string;
  value: React.ReactNode;
  color?: string;
  border?: string;
  bg?: string;
}) {
  return (
    <div className={`rounded-xl border ${border} ${bg} p-4`}>
      <p
        className={`mb-1 text-xs font-medium ${color === "text-white" ? "text-gray-400" : color}`}
      >
        {label}
      </p>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function PutCallGauge({ ratio }: { ratio: number | null | undefined }) {
  const { t } = useI18n();
  if (ratio == null)
    return (
      <span className="text-2xl font-bold text-gray-500">
        {t("summary.putCallNA")}
      </span>
    );
  const color =
    ratio > 1.2
      ? "text-red-400"
      : ratio < 0.8
        ? "text-emerald-400"
        : "text-cyan-300";
  return (
    <span className={`text-2xl font-bold tabular-nums ${color}`}>{ratio}</span>
  );
}

function QuickAccessCard({
  icon: Icon,
  label,
  href,
  locked,
  color,
}: {
  icon: React.ElementType;
  label: string;
  href: string;
  locked?: boolean;
  color: string;
}) {
  return (
    <Link
      href={locked ? "/pricing" : href}
      title={locked ? "升级解锁" : undefined}
      className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all ${
        locked
          ? "border-white/5 bg-white/3 text-gray-600 hover:border-white/10"
          : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.08]"
      }`}
    >
      <Icon className={`h-6 w-6 ${locked ? "text-gray-700" : color}`} />
      <span className="text-xs font-medium">{label}</span>
      {locked && (
        <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-600">
          升级
        </span>
      )}
    </Link>
  );
}

export default function DashboardPage() {
  const { t } = useI18n();
  const { plan, can } = useProfile();

  const [symbolInput, setSymbolInput] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [minScore, setMinScore] = useState(20);
  const [selectedSignal, setSelectedSignal] = useState<
    (typeof signals)[number] | null
  >(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleNewSignals = useCallback((count: number) => {
    const id = `toast-${Date.now()}`;
    setToasts((prev) => [
      ...prev,
      { id, message: `🆕 ${count} 条新信号到达`, type: "success" as const },
    ]);
  }, []);

  const filters = useMemo(
    () => ({
      symbol: symbolInput.trim() || undefined,
      module: moduleFilter || undefined,
      minScore,
      limit: 30,
      offset: 0,
    }),
    [symbolInput, moduleFilter, minScore],
  );

  const { signals, summary, total, loading, error } = useMarketSignals({
    ...filters,
    onNewSignals: handleNewSignals,
  });

  const planInfo =
    PLAN_LABELS[plan as keyof typeof PLAN_LABELS] ?? PLAN_LABELS.free;

  const bullish = summary?.bullish ?? 0;
  const bearish = summary?.bearish ?? 0;
  const neutral = summary?.neutral ?? 0;
  const totalDir = bullish + bearish + neutral || 1;
  const bullPct = Math.round((bullish / totalDir) * 100);
  const bearPct = Math.round((bearish / totalDir) * 100);
  const neutPct = 100 - bullPct - bearPct;

  const topSymbols = summary?.top_symbols ?? [];
  const maxSymbolCount = topSymbols.length
    ? Math.max(...topSymbols.map((s) => s.count))
    : 1;

  const moduleEntries = Object.entries(summary?.by_module ?? {}).sort(
    (a, b) => b[1] - a[1],
  );
  const maxModuleCount = moduleEntries.length
    ? Math.max(...moduleEntries.map(([, count]) => count))
    : 1;

  if (error) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <div className="text-4xl">⚠️</div>
        <div className="text-xl text-red-400">{error.message}</div>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return (
    <div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* ── Header ── */}
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold text-white">市场雷达</h1>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${planInfo.color}`}
                >
                  {planInfo.zh}
                </span>
              </div>
              <p className="mt-1 text-gray-400">AI 实时市场信号监控中心</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-2">
                <span className="font-medium text-white">{total}</span>
                <span className="ml-1 text-sm text-gray-400">
                  {t("common.signals")}
                </span>
              </div>
              {plan === "free" && (
                <Link
                  href="/pricing"
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/20"
                >
                  升级 Pro →
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto space-y-8 px-6 py-8">
        {/* ── Summary Metrics ── */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <StatCard
            label={t("summary.total24h")}
            value={summary?.total_signals ?? 0}
          />
          <StatCard
            label={t("summary.bullish")}
            value={bullish}
            color="text-emerald-400"
            border="border-emerald-500/20"
            bg="bg-emerald-500/10"
          />
          <StatCard
            label={t("summary.bearish")}
            value={bearish}
            color="text-red-400"
            border="border-red-500/20"
            bg="bg-red-500/10"
          />
          <StatCard
            label={t("summary.avgScore")}
            value={summary?.average_score ?? 0}
            color="text-cyan-300"
            border="border-cyan-500/20"
            bg="bg-cyan-500/10"
          />
          <div className="rounded-xl border border-purple-500/20 bg-purple-500/10 p-4">
            <p className="mb-1 text-xs font-medium text-purple-300">
              {t("summary.putCallRatio")}
            </p>
            <PutCallGauge ratio={summary?.put_call_ratio} />
          </div>
        </div>

        {/* ── Analytics Row ── */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* Top Symbols */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-4 font-semibold text-white">
              {t("chart.topSymbols")}
            </h3>
            {topSymbols.length === 0 ? (
              <p className="text-sm text-gray-500">暂无数据</p>
            ) : (
              <div className="space-y-3">
                {topSymbols.map(({ symbol, count }, i) => {
                  const width = Math.max(
                    8,
                    Math.round((count / maxSymbolCount) * 100),
                  );
                  const medal = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"][i] ?? "";
                  return (
                    <Link
                      key={symbol}
                      href={`/dashboard/stocks/${symbol}`}
                      className="block"
                    >
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-gray-300">
                          {medal}{" "}
                          <span className="font-bold text-white">
                            ${symbol}
                          </span>
                        </span>
                        <span className="text-gray-400">
                          {count} {t("chart.signals")}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-700/80">
                        <div
                          className="h-full bg-cyan-400 transition-all"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Direction Distribution */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-4 font-semibold text-white">
              {t("chart.directionDist")}
            </h3>
            {(summary?.total_signals ?? 0) === 0 ? (
              <p className="text-sm text-gray-500">暂无数据</p>
            ) : (
              <div className="space-y-4">
                <div className="flex h-7 overflow-hidden rounded-full">
                  {bullPct > 0 && (
                    <div
                      className="flex items-center justify-center bg-emerald-500 text-[10px] font-bold text-white"
                      style={{ width: `${bullPct}%` }}
                    >
                      {bullPct >= 12 ? `${bullPct}%` : ""}
                    </div>
                  )}
                  {neutPct > 0 && (
                    <div
                      className="flex items-center justify-center bg-yellow-500/70 text-[10px] font-bold text-white"
                      style={{ width: `${neutPct}%` }}
                    >
                      {neutPct >= 12 ? `${neutPct}%` : ""}
                    </div>
                  )}
                  {bearPct > 0 && (
                    <div
                      className="flex items-center justify-center bg-red-500 text-[10px] font-bold text-white"
                      style={{ width: `${bearPct}%` }}
                    >
                      {bearPct >= 12 ? `${bearPct}%` : ""}
                    </div>
                  )}
                </div>
                <div className="space-y-2 text-sm">
                  {[
                    {
                      label: t("chart.bullish"),
                      count: bullish,
                      pct: bullPct,
                      color: "bg-emerald-500 text-emerald-300",
                    },
                    {
                      label: t("chart.neutral"),
                      count: neutral,
                      pct: neutPct,
                      color: "bg-yellow-500/70 text-yellow-300",
                    },
                    {
                      label: t("chart.bearish"),
                      count: bearish,
                      pct: bearPct,
                      color: "bg-red-500 text-red-300",
                    },
                  ].map(({ label, count, pct, color }) => (
                    <div
                      key={label}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block h-3 w-3 rounded-sm ${color.split(" ")[0]}`}
                        />
                        <span className={color.split(" ")[1]}>{label}</span>
                      </div>
                      <span className="text-white">
                        {count} <span className="text-gray-500">({pct}%)</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Module Distribution */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-4 font-semibold text-white">
              {t("chart.moduleDist")}
            </h3>
            {moduleEntries.length === 0 ? (
              <p className="text-sm text-gray-500">暂无数据</p>
            ) : (
              <div className="space-y-3">
                {moduleEntries.map(([module, count]) => {
                  const width = Math.max(
                    8,
                    Math.round((count / maxModuleCount) * 100),
                  );
                  return (
                    <div key={module}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-gray-300">
                          {t(`module.${module}` as Parameters<typeof t>[0]) ||
                            module}
                        </span>
                        <span className="text-gray-500">{count}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-700/80">
                        <div
                          className="h-full bg-cyan-400"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Quick Access to Data Sources ── */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-white">数据源快捷入口</h2>
            {plan === "free" && (
              <Link
                href="/pricing"
                className="text-xs text-amber-400 hover:underline"
              >
                解锁全部 →
              </Link>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            <QuickAccessCard
              icon={DollarSign}
              label="期权异动"
              href="/dashboard/options"
              locked={!can("options_flow")}
              color="text-emerald-400"
            />
            <QuickAccessCard
              icon={Users}
              label="内部交易"
              href="/dashboard/insider"
              locked={!can("insider_trades")}
              color="text-blue-400"
            />
            <QuickAccessCard
              icon={Layers}
              label="暗池大单"
              href="/dashboard/darkpool"
              locked={!can("dark_pool")}
              color="text-purple-400"
            />
            <QuickAccessCard
              icon={MessageSquare}
              label="市场情绪"
              href="/dashboard/sentiment"
              locked={!can("sentiment")}
              color="text-yellow-400"
            />
            <QuickAccessCard
              icon={TrendingUp}
              label="技术分析"
              href="/dashboard/technical"
              locked={!can("technical")}
              color="text-cyan-400"
            />
            <QuickAccessCard
              icon={Brain}
              label="AI 报告"
              href="/dashboard/reports"
              locked={!can("ai_reports")}
              color="text-pink-400"
            />
          </div>
        </div>

        {/* ── Signal Filters ── */}
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-white/10 bg-white/5 p-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t("filters.symbol")}
            </label>
            <input
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              placeholder="AAPL"
              className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t("filters.module")}
            </label>
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white"
            >
              {MODULE_OPTIONS.map((m) => (
                <option key={m || "all"} value={m}>
                  {m
                    ? t(`module.${m}` as Parameters<typeof t>[0]) || m
                    : t("filters.all")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t("filters.minScore")}
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value) || 0)}
              className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setSymbolInput("");
                setModuleFilter("");
                setMinScore(20);
              }}
              className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20"
            >
              {t("filters.reset")}
            </button>
          </div>
        </div>

        {/* ── Signal List ── */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">
              {t("dashboard.sectionTitle")}
            </h2>
            <span className="text-sm text-gray-500">
              点击信号卡片查看详情 · 点击标的跳转工作台
            </span>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <SignalCardSkeleton key={i} />
              ))}
            </div>
          ) : signals.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <div className="mb-4 text-5xl opacity-40">📭</div>
              <p className="text-lg text-gray-400">{t("dashboard.empty")}</p>
              <p className="mt-2 text-sm text-gray-500">
                {t("dashboard.emptyHint")}
              </p>
            </div>
          ) : (
            <div className="animate-stagger grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {signals.map((signal) => (
                <div key={signal.id} className="animate-slide-up">
                  <SignalCard
                    signal={signal}
                    onClick={() => setSelectedSignal(signal)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <SlidePanel
        isOpen={!!selectedSignal}
        onClose={() => setSelectedSignal(null)}
        title={t("detail.title")}
      >
        {selectedSignal && <SignalDetail signal={selectedSignal} />}
      </SlidePanel>

      <footer className="mt-20 border-t border-white/10 bg-white/5 py-6 backdrop-blur-sm">
        <div className="container mx-auto px-6 text-center text-sm text-gray-600">
          <p>
            {t("footer.text")} ·{" "}
            <Link href="/pricing" className="text-gray-500 hover:text-gray-300">
              查看定价
            </Link>{" "}
            ·{" "}
            <Link
              href="/dashboard/admin"
              className="text-gray-500 hover:text-gray-300"
            >
              系统状态
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
