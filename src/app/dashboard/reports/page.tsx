"use client";

import { useState } from "react";

import {
  AlertTriangle,
  BarChart3,
  Brain,
  Clock,
  Moon,
  RefreshCw,
  Sparkles,
  Sun,
  Sunset,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";

import { useDailyReport } from "@/lib/hooks/useDailyReport";
import { useI18n } from "@/lib/i18n/provider";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://faithful-simplicity-production-3a01.up.railway.app";

// ── Shared sub-components ──────────────────────────────────────────────────────

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

function BulletList({
  icon: Icon,
  title,
  items,
  color,
}: {
  icon: React.ElementType;
  title: string;
  items: string[];
  color: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className={`mb-3 flex items-center gap-2 ${color}`}>
        <Icon className="h-5 w-5" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function GenerateButton({
  loading,
  onClick,
  label,
}: {
  loading: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500/20 to-purple-500/20 px-5 py-2.5 text-sm font-medium text-white transition-all hover:from-cyan-500/30 hover:to-purple-500/30 disabled:opacity-50"
    >
      {loading ? (
        <RefreshCw className="h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="h-4 w-4" />
      )}
      {label}
    </button>
  );
}

function EmptyState({
  onGenerate,
  loading,
  label,
}: {
  onGenerate: () => void;
  loading: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center py-20">
      <Brain className="mb-6 h-16 w-16 text-cyan-400/40" />
      <p className="mb-6 text-center text-sm text-gray-400">{label}</p>
      <GenerateButton loading={loading} onClick={onGenerate} label="Generate" />
    </div>
  );
}

// ── Daily report tab (existing) ────────────────────────────────────────────────

function DailyTab() {
  const { t } = useI18n();
  const { report, loading, error, generate } = useDailyReport();

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <GenerateButton
          loading={loading}
          onClick={generate}
          label={
            loading ? t("reports.generating") : t("reports.generateReport")
          }
        />
      </div>
      {error ? (
        <div className="flex flex-col items-center py-20">
          <div className="mb-2 text-red-400">{error.message}</div>
          <p className="text-sm text-gray-500">{t("reports.errorHint")}</p>
        </div>
      ) : !report && !loading ? (
        <EmptyState
          onGenerate={generate}
          loading={loading}
          label={t("reports.emptyDesc")}
        />
      ) : loading && !report ? (
        <div className="flex flex-col items-center py-20">
          <RefreshCw className="mb-4 h-10 w-10 animate-spin text-cyan-400" />
          <p className="text-gray-400">{t("reports.generatingHint")}</p>
        </div>
      ) : report ? (
        <div className="animate-fade-in space-y-4">
          <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
            <Sparkles className="h-3 w-3" />
            {t("reports.generatedAt")}{" "}
            {new Date(report.generated_at).toLocaleString()}
          </div>
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
          <div className="rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-xs text-gray-500">
            {t("reports.disclaimer")}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Generic fetch tab ─────────────────────────────────────────────────────────

function FetchReportTab({
  endpoint,
  renderContent,
}: {
  endpoint: string;
  renderContent: (
    data: Record<string, unknown>,
    locale: string,
  ) => React.ReactNode;
}) {
  const { locale } = useI18n();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/reports/${endpoint}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <GenerateButton
          loading={loading}
          onClick={generate}
          label={loading ? "Generating…" : "Generate"}
        />
      </div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {loading && !data && (
        <div className="flex flex-col items-center py-20">
          <RefreshCw className="mb-4 h-10 w-10 animate-spin text-cyan-400" />
          <p className="text-gray-400">Generating report…</p>
        </div>
      )}
      {!data && !loading && !error && (
        <EmptyState
          onGenerate={generate}
          loading={loading}
          label="Click Generate to create this report"
        />
      )}
      {data && renderContent(data, locale)}
    </div>
  );
}

// ── Tab render helpers ────────────────────────────────────────────────────────

function renderPremarket(data: Record<string, unknown>, locale: string) {
  const zh = locale === "zh";
  const bias = data.opening_bias as string;
  const biasColor =
    bias === "bullish"
      ? "text-emerald-400"
      : bias === "bearish"
        ? "text-red-400"
        : "text-yellow-400";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Sparkles className="h-3 w-3" />
        {new Date(data.generated_at as string).toLocaleString()}
      </div>
      <BulletList
        icon={Sun}
        title={zh ? "今日重点关注" : "Key Watchpoints"}
        items={
          (zh ? data.key_watchpoints_zh : data.key_watchpoints) as string[]
        }
        color="text-cyan-400"
      />
      <div className="grid gap-4 md:grid-cols-2">
        <ReportSection
          icon={TrendingUp}
          title={zh ? "操作建议" : "Strategy Focus"}
          content={
            (zh ? data.strategy_focus_zh : data.strategy_focus) as string
          }
          color="text-emerald-400"
        />
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
            {zh ? "开盘偏向" : "Opening Bias"}
            <span className={`ml-2 font-bold ${biasColor}`}>{bias}</span>
          </div>
          <p className="text-sm text-gray-300">
            {(zh ? data.risk_note_zh : data.risk_note) as string}
          </p>
        </div>
      </div>
    </div>
  );
}

function renderMidday(data: Record<string, unknown>, locale: string) {
  const zh = locale === "zh";
  const adj = data.strategy_adjustment as string;
  const adjColor =
    adj === "add"
      ? "text-emerald-400"
      : adj === "reduce"
        ? "text-red-400"
        : "text-yellow-400";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Sparkles className="h-3 w-3" />
        {new Date(data.generated_at as string).toLocaleString()}
      </div>
      <ReportSection
        icon={BarChart3}
        title={zh ? "上午行情回顾" : "Morning Summary"}
        content={
          (zh ? data.morning_summary_zh : data.morning_summary) as string
        }
        color="text-cyan-400"
      />
      <div className="grid gap-4 md:grid-cols-2">
        <ReportSection
          icon={Zap}
          title={zh ? "资金流向" : "Flow Observation"}
          content={
            (zh ? data.flow_observation_zh : data.flow_observation) as string
          }
          color="text-purple-400"
        />
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
            {zh ? "仓位建议" : "Position Adjustment"}
            <span className={`ml-2 font-bold ${adjColor}`}>{adj}</span>
          </div>
          <p className="text-sm text-gray-300">
            {(zh ? data.strategy_note_zh : data.strategy_note) as string}
          </p>
        </div>
      </div>
    </div>
  );
}

function renderClosing(data: Record<string, unknown>, locale: string) {
  const zh = locale === "zh";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Sparkles className="h-3 w-3" />
        {new Date(data.generated_at as string).toLocaleString()}
      </div>
      <ReportSection
        icon={Sunset}
        title={zh ? "今日行情总结" : "Session Summary"}
        content={
          (zh ? data.session_summary_zh : data.session_summary) as string
        }
        color="text-amber-400"
      />
      <ReportSection
        icon={BarChart3}
        title={zh ? "信号表现" : "Signal Performance"}
        content={
          (zh ? data.signal_performance_zh : data.signal_performance) as string
        }
        color="text-cyan-400"
      />
      <div className="grid gap-4 md:grid-cols-2">
        <BulletList
          icon={TrendingUp}
          title={zh ? "明日关注" : "Tomorrow's Watchlist"}
          items={
            (zh
              ? data.tomorrow_watchlist_zh
              : data.tomorrow_watchlist) as string[]
          }
          color="text-emerald-400"
        />
        <ReportSection
          icon={AlertTriangle}
          title={zh ? "隔夜风险" : "Overnight Risk"}
          content={
            (zh ? data.overnight_risk_zh : data.overnight_risk) as string
          }
          color="text-red-400"
        />
      </div>
    </div>
  );
}

function renderWeekly(data: Record<string, unknown>, locale: string) {
  const zh = locale === "zh";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Sparkles className="h-3 w-3" />
        {new Date(data.generated_at as string).toLocaleString()}
      </div>
      <ReportSection
        icon={BarChart3}
        title={zh ? "本周行情总结" : "Weekly Summary"}
        content={(zh ? data.week_summary_zh : data.week_summary) as string}
        color="text-cyan-400"
      />
      <div className="grid gap-4 md:grid-cols-2">
        <ReportSection
          icon={TrendingUp}
          title={zh ? "策略表现" : "Strategy Performance"}
          content={
            (zh
              ? data.strategy_performance_zh
              : data.strategy_performance) as string
          }
          color="text-emerald-400"
        />
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
            {zh ? "体制变化" : "Regime Shift"}
            <span
              className={`ml-2 font-bold ${data.regime_shift ? "text-amber-400" : "text-gray-500"}`}
            >
              {data.regime_shift
                ? zh
                  ? "有变化"
                  : "Yes"
                : zh
                  ? "稳定"
                  : "Stable"}
            </span>
          </div>
          <p className="text-sm text-gray-300">
            {(zh ? data.regime_note_zh : data.regime_note) as string}
          </p>
        </div>
      </div>
      <BulletList
        icon={Moon}
        title={zh ? "下周关注主题" : "Next Week Themes"}
        items={
          (zh ? data.next_week_themes_zh : data.next_week_themes) as string[]
        }
        color="text-purple-400"
      />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

type ReportTab = "daily" | "premarket" | "midday" | "closing" | "weekly";

const TABS: {
  key: ReportTab;
  zhLabel: string;
  enLabel: string;
  icon: React.ElementType;
}[] = [
  { key: "daily", zhLabel: "日报", enLabel: "Daily", icon: BarChart3 },
  { key: "premarket", zhLabel: "盘前", enLabel: "Pre-Market", icon: Sun },
  { key: "midday", zhLabel: "盘中", enLabel: "Midday", icon: Clock },
  { key: "closing", zhLabel: "收盘", enLabel: "Closing", icon: Sunset },
  { key: "weekly", zhLabel: "周报", enLabel: "Weekly", icon: Moon },
];

export default function ReportsPage() {
  const { t, locale } = useI18n();
  const [activeTab, setActiveTab] = useState<ReportTab>("daily");
  const zh = locale === "zh";

  return (
    <div>
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div>
            <h1 className="text-3xl font-bold text-white">
              {t("nav.reports")}
            </h1>
            <p className="mt-1 text-gray-400">{t("reports.subtitle")}</p>
          </div>
          {/* Tabs */}
          <div className="mt-4 flex gap-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-all ${
                    activeTab === tab.key
                      ? "bg-cyan-500/20 font-semibold text-cyan-200"
                      : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {zh ? tab.zhLabel : tab.enLabel}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {activeTab === "daily" && <DailyTab />}
        {activeTab === "premarket" && (
          <FetchReportTab
            endpoint="premarket"
            renderContent={renderPremarket}
          />
        )}
        {activeTab === "midday" && (
          <FetchReportTab endpoint="midday" renderContent={renderMidday} />
        )}
        {activeTab === "closing" && (
          <FetchReportTab endpoint="closing" renderContent={renderClosing} />
        )}
        {activeTab === "weekly" && (
          <FetchReportTab endpoint="weekly" renderContent={renderWeekly} />
        )}
      </main>
    </div>
  );
}
