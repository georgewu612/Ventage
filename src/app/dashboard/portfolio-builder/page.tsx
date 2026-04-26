"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Layers,
  RotateCcw,
  Save,
  Target,
  TrendingUp,
} from "lucide-react";

import { usePortfolioBuilder } from "@/lib/hooks/usePortfolioBuilder";
import { useProfile } from "@/lib/hooks/useProfile";
import { useI18n } from "@/lib/i18n/provider";

// ── Constants ──────────────────────────────────────────────────────────────────

const RISK_OPTIONS = [
  { value: "conservative", zh: "保守", en: "Conservative" },
  { value: "moderate", zh: "稳健", en: "Moderate" },
  { value: "balanced", zh: "平衡", en: "Balanced" },
  { value: "aggressive", zh: "进取", en: "Aggressive" },
  { value: "speculative", zh: "激进", en: "Speculative" },
] as const;

const RETURN_OPTIONS = [
  { value: "capital_preservation", zh: "资本保全", en: "Capital Preservation" },
  { value: "income", zh: "稳定收益", en: "Income" },
  { value: "balanced", zh: "均衡增长", en: "Balanced Growth" },
  { value: "growth", zh: "高速增长", en: "High Growth" },
];

const PERIOD_OPTIONS = [
  { value: "intraday", zh: "日内", en: "Intraday" },
  { value: "1-5d", zh: "1-5天", en: "1–5 Days" },
  { value: "1-4w", zh: "1-4周", en: "1–4 Weeks" },
  { value: "1-3m", zh: "1-3月", en: "1–3 Months" },
  { value: "6m+", zh: "6月以上", en: "6+ Months" },
];

const STYLE_OPTIONS = [
  { value: "trend", zh: "趋势" },
  { value: "momentum", zh: "动量" },
  { value: "mean_reversion", zh: "均值回归" },
  { value: "event", zh: "事件驱动" },
  { value: "value", zh: "价值" },
  { value: "quant", zh: "量化" },
];

const UNIVERSE_OPTIONS = [
  { value: "us_etf", zh: "美股ETF", en: "US ETFs" },
  { value: "us_large", zh: "美股大盘", en: "US Large-cap" },
  { value: "us_all", zh: "美股全市场", en: "US All-cap" },
  { value: "global", zh: "全球", en: "Global" },
];

const SECTOR_OPTIONS = [
  "科技",
  "金融",
  "医疗",
  "消费",
  "能源",
  "工业",
  "地产",
  "公用事业",
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  labelKey,
}: {
  options: readonly { value: T; zh: string; en?: string }[];
  value: T;
  onChange: (v: T) => void;
  labelKey: "zh" | "en";
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg border px-3 py-1.5 text-sm transition-all ${
            value === o.value
              ? "border-cyan-500 bg-cyan-500/15 text-cyan-300"
              : "border-white/10 bg-white/5 text-gray-400 hover:border-white/30"
          }`}
        >
          {labelKey === "en" && o.en ? o.en : o.zh}
        </button>
      ))}
    </div>
  );
}

function MultiToggle({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (v: string) =>
    onChange(
      selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v],
    );
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => toggle(o)}
          className={`rounded-lg border px-3 py-1.5 text-sm transition-all ${
            selected.includes(o)
              ? "border-cyan-500 bg-cyan-500/15 text-cyan-300"
              : "border-white/10 bg-white/5 text-gray-400 hover:border-white/30"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-2 block text-xs font-medium tracking-wide text-gray-500 uppercase">
      {children}
    </span>
  );
}

// ── Candidate list ─────────────────────────────────────────────────────────────

function CandidateList({
  candidates,
  locale,
  color = "cyan",
}: {
  candidates: {
    symbol: string;
    rationale: string;
    rationale_en: string;
    weight_pct: number | null;
  }[];
  locale: string;
  color?: string;
}) {
  if (!candidates.length)
    return (
      <p className="text-sm text-gray-600">{locale === "zh" ? "无" : "None"}</p>
    );
  const colorMap: Record<string, string> = {
    cyan: "text-cyan-300",
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    purple: "text-purple-300",
    red: "text-red-400",
  };
  return (
    <div className="space-y-2">
      {candidates.map((c) => (
        <div
          key={c.symbol}
          className="flex items-start justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2"
        >
          <div>
            <span
              className={`text-sm font-semibold ${colorMap[color] ?? "text-cyan-300"}`}
            >
              {c.symbol}
            </span>
            {c.weight_pct !== null && (
              <span className="ml-2 text-xs text-gray-500">
                {c.weight_pct}%
              </span>
            )}
            <p className="mt-0.5 text-xs text-gray-500">
              {locale === "zh" ? c.rationale : c.rationale_en}
            </p>
          </div>
          <Link
            href={`/dashboard/stocks/${c.symbol}`}
            className="ml-3 flex-shrink-0 text-xs text-gray-600 hover:text-cyan-400"
          >
            →
          </Link>
        </div>
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PortfolioBuilderPage() {
  const { locale } = useI18n();
  const { profile } = useProfile();
  const { building, recommendation, error, buildPortfolio, reset } =
    usePortfolioBuilder();

  // Form state
  const [riskPref, setRiskPref] = useState<
    "conservative" | "moderate" | "balanced" | "aggressive" | "speculative"
  >("moderate");
  const [maxDd, setMaxDd] = useState(12);
  const [returnPref, setReturnPref] = useState("balanced");
  const [holdPeriod, setHoldPeriod] = useState("1-3m");
  const [tradingStyle, setTradingStyle] = useState("trend");
  const [universe, setUniverse] = useState("us_large");
  const [sectors, setSectors] = useState<string[]>([]);
  const [aiExpanded, setAiExpanded] = useState(true);

  // Active candidates tab
  const [candidateTab, setCandidateTab] = useState<
    "core" | "enhance" | "satellite" | "watchlist" | "avoid"
  >("core");

  const zh = locale === "zh";

  function handleBuild() {
    if (!profile?.user_id) return;
    buildPortfolio({
      user_id: profile.user_id,
      risk_preference: riskPref,
      max_drawdown_pct: maxDd,
      return_preference: returnPref,
      holding_period: holdPeriod,
      trading_style: tradingStyle,
      universe,
      sector_preferences: sectors,
      risk_limits: {},
    });
  }

  const alloc = recommendation?.allocation_structure;

  const candidateTabs = [
    {
      key: "core" as const,
      label: zh ? "核心仓" : "Core",
      color: "cyan",
      data: recommendation?.core_candidates ?? [],
    },
    {
      key: "enhance" as const,
      label: zh ? "增强仓" : "Enhance",
      color: "emerald",
      data: recommendation?.enhance_candidates ?? [],
    },
    {
      key: "satellite" as const,
      label: zh ? "卫星仓" : "Satellite",
      color: "purple",
      data: recommendation?.satellite_candidates ?? [],
    },
    {
      key: "watchlist" as const,
      label: zh ? "观察名单" : "Watchlist",
      color: "amber",
      data: recommendation?.watchlist_candidates ?? [],
    },
    {
      key: "avoid" as const,
      label: zh ? "回避名单" : "Avoid",
      color: "red",
      data: recommendation?.avoid_candidates ?? [],
    },
  ];

  const activeCandidates =
    candidateTabs.find((t) => t.key === candidateTab) ?? candidateTabs[0];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-white">
          <Bot className="h-5 w-5 text-cyan-400" />
          {zh ? "AI 组合构建器" : "AI Portfolio Builder"}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {zh
            ? "告诉 AI 你的投资偏好，它将结合当前市场环境为你定制组合方案"
            : "Tell the AI your investment goals and it will craft a portfolio tailored to current market conditions"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* ── Input panel (always visible) ── */}
        <div className="space-y-5 lg:col-span-2">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            {/* A. Risk preference */}
            <div className="mb-5">
              <SectionLabel>
                {zh ? "A. 风险偏好" : "A. Risk Preference"}
              </SectionLabel>
              <ToggleGroup
                options={RISK_OPTIONS}
                value={riskPref}
                onChange={setRiskPref}
                labelKey={zh ? "zh" : "en"}
              />
            </div>

            {/* B. Max drawdown */}
            <div className="mb-5">
              <SectionLabel>
                {zh ? "B. 最大回撤容忍" : "B. Max Drawdown Tolerance"} — {maxDd}
                %
              </SectionLabel>
              <input
                type="range"
                min={5}
                max={25}
                step={1}
                value={maxDd}
                onChange={(e) => setMaxDd(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
              <div className="mt-1 flex justify-between text-xs text-gray-600">
                <span>5%</span>
                <span>25%</span>
              </div>
            </div>

            {/* C. Return preference */}
            <div className="mb-5">
              <SectionLabel>
                {zh ? "C. 收益偏好" : "C. Return Goal"}
              </SectionLabel>
              <ToggleGroup
                options={RETURN_OPTIONS}
                value={returnPref as never}
                onChange={setReturnPref as never}
                labelKey={zh ? "zh" : "en"}
              />
            </div>

            {/* D. Holding period */}
            <div className="mb-5">
              <SectionLabel>
                {zh ? "D. 持仓周期" : "D. Holding Period"}
              </SectionLabel>
              <ToggleGroup
                options={PERIOD_OPTIONS}
                value={holdPeriod as never}
                onChange={setHoldPeriod as never}
                labelKey={zh ? "zh" : "en"}
              />
            </div>

            {/* E. Trading style */}
            <div className="mb-5">
              <SectionLabel>
                {zh ? "E. 交易风格" : "E. Trading Style"}
              </SectionLabel>
              <ToggleGroup
                options={STYLE_OPTIONS}
                value={tradingStyle as never}
                onChange={setTradingStyle as never}
                labelKey="zh"
              />
            </div>

            {/* F. Universe */}
            <div className="mb-5">
              <SectionLabel>{zh ? "F. 标的范围" : "F. Universe"}</SectionLabel>
              <ToggleGroup
                options={UNIVERSE_OPTIONS}
                value={universe as never}
                onChange={setUniverse as never}
                labelKey={zh ? "zh" : "en"}
              />
            </div>

            {/* G. Sectors */}
            <div className="mb-5">
              <SectionLabel>
                {zh ? "G. 行业偏好（多选）" : "G. Sector Preferences"}
              </SectionLabel>
              <MultiToggle
                options={SECTOR_OPTIONS}
                selected={sectors}
                onChange={setSectors}
              />
            </div>

            {/* Build button */}
            <button
              onClick={handleBuild}
              disabled={building || !profile?.user_id}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-3 text-sm font-semibold text-white transition-all hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {building ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {zh ? "AI 构建中…" : "Building…"}
                </>
              ) : (
                <>
                  <Bot className="h-4 w-4" />
                  {zh ? "🤖 AI 生成组合方案" : "🤖 Generate Portfolio"}
                </>
              )}
            </button>

            {error && (
              <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* ── Result panel ── */}
        <div className="space-y-4 lg:col-span-3">
          {!recommendation ? (
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-white/10">
              <div className="text-center">
                <Layers className="mx-auto mb-3 h-10 w-10 text-gray-700" />
                <p className="text-sm text-gray-600">
                  {zh
                    ? "填写左侧偏好后点击生成，AI 将为你构建个性化组合"
                    : "Fill in your preferences and click Generate"}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Portfolio type + regime badge */}
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs tracking-wide text-gray-500 uppercase">
                      {zh ? "组合类型" : "Portfolio Type"}
                    </p>
                    <h2 className="mt-1 text-lg font-bold text-white">
                      {zh
                        ? recommendation.portfolio_type
                        : recommendation.portfolio_type_en}
                    </h2>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded-full bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-300">
                      {recommendation.regime_at_creation}
                    </span>
                    <span className="text-xs text-gray-500">
                      {zh ? "置信度" : "Confidence"}{" "}
                      {recommendation.confidence_score}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Recommended templates */}
              {recommendation.recommended_templates.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    {zh ? "推荐策略模板" : "Matched Strategy Templates"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {recommendation.recommended_templates.map((t) => (
                      <span
                        key={t}
                        className="rounded-lg bg-white/10 px-2.5 py-1 text-xs text-gray-300"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Allocation pie (CSS) */}
              {alloc && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    {zh ? "仓位结构" : "Allocation Structure"}
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      {
                        label: zh ? "核心仓" : "Core",
                        pct: alloc.core,
                        color: "bg-cyan-500",
                      },
                      {
                        label: zh ? "增强仓" : "Enhance",
                        pct: alloc.enhance,
                        color: "bg-emerald-500",
                      },
                      {
                        label: zh ? "卫星仓" : "Satellite",
                        pct: alloc.satellite,
                        color: "bg-purple-500",
                      },
                    ].map((seg) => (
                      <div
                        key={seg.label}
                        className="flex flex-col items-center gap-1"
                      >
                        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                          <div
                            className={`h-full ${seg.color}`}
                            style={{ width: `${seg.pct}%` }}
                          />
                        </div>
                        <span className="text-sm font-semibold text-white">
                          {seg.pct}%
                        </span>
                        <span className="text-xs text-gray-500">
                          {seg.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Candidate tabs */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3 flex flex-wrap gap-1">
                  {candidateTabs.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setCandidateTab(tab.key)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                        candidateTab === tab.key
                          ? "bg-white/10 text-white"
                          : "text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      {tab.label}
                      <span className="ml-1 text-gray-600">
                        ({tab.data.length})
                      </span>
                    </button>
                  ))}
                </div>
                <CandidateList
                  candidates={activeCandidates.data}
                  locale={locale}
                  color={activeCandidates.color}
                />
              </div>

              {/* Backtest summary */}
              {recommendation.backtest_summary?.total_return_pct !==
                undefined && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    <TrendingUp className="h-3.5 w-3.5" />
                    {zh
                      ? `核心仓 ${recommendation.backtest_summary.period_days} 日回测`
                      : `Core ${recommendation.backtest_summary.period_days}-Day Backtest`}
                  </p>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      {
                        label: zh ? "总收益" : "Return",
                        value: `${recommendation.backtest_summary.total_return_pct > 0 ? "+" : ""}${recommendation.backtest_summary.total_return_pct}%`,
                        color:
                          recommendation.backtest_summary.total_return_pct >= 0
                            ? "text-emerald-400"
                            : "text-red-400",
                      },
                      {
                        label: zh ? "最大回撤" : "Max DD",
                        value: `${recommendation.backtest_summary.max_drawdown_pct}%`,
                        color: "text-amber-400",
                      },
                      {
                        label: "Sharpe",
                        value:
                          recommendation.backtest_summary.sharpe_ratio.toFixed(
                            2,
                          ),
                        color: "text-cyan-400",
                      },
                      {
                        label: zh ? "胜率" : "Win Rate",
                        value: `${recommendation.backtest_summary.win_rate_pct}%`,
                        color: "text-purple-400",
                      },
                    ].map((stat) => (
                      <div key={stat.label} className="text-center">
                        <p className={`text-base font-semibold ${stat.color}`}>
                          {stat.value}
                        </p>
                        <p className="text-xs text-gray-500">{stat.label}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-gray-600">
                    {zh
                      ? "⚠️ 回测数据仅供参考，不代表未来表现"
                      : "⚠️ Backtest for reference only — past performance does not guarantee future results"}
                  </p>
                </div>
              )}

              {/* AI Explanation */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <button
                  onClick={() => setAiExpanded((v) => !v)}
                  className="flex w-full items-center justify-between text-xs font-semibold tracking-wide text-gray-500 uppercase"
                >
                  <span className="flex items-center gap-1.5">
                    <Bot className="h-3.5 w-3.5" />
                    {zh ? "AI 解释" : "AI Explanation"}
                  </span>
                  {aiExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
                {aiExpanded && (
                  <p className="mt-3 text-sm leading-relaxed text-gray-300">
                    {zh
                      ? recommendation.ai_explanation
                      : recommendation.ai_explanation_en}
                  </p>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-3">
                <button
                  onClick={reset}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-3 text-sm text-gray-400 hover:bg-white/10"
                >
                  <RotateCcw className="h-4 w-4" />
                  {zh ? "重新生成" : "Reset"}
                </button>
                <Link
                  href="/dashboard/quant-lab"
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 py-3 text-sm text-cyan-300 hover:bg-cyan-500/20"
                >
                  <FlaskConical className="h-4 w-4" />
                  {zh ? "在 Quant Lab 验证" : "Validate in Quant Lab"}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
