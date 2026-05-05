"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Award,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Shield,
} from "lucide-react";

import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CheckItem {
  name: string;
  name_zh: string;
  passed: boolean;
  value: number | null;
  prior_value: number | null;
  note: string;
}

type Rating = "high_quality" | "neutral" | "low_quality" | "not_applicable";

interface FScoreResult {
  symbol: string;
  sector: string | null;
  score: number;
  max_score: number;
  rating: Rating;
  pass_count: number;
  applicable: boolean;
  category_scores: {
    profitability: number;
    leverage_liquidity: number;
    operating_efficiency: number;
  };
  profitability: CheckItem[];
  leverage_liquidity: CheckItem[];
  operating_efficiency: CheckItem[];
  warnings: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatValue(v: number | null): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1) return v.toFixed(2);
  // Likely a ratio (ROA, margin, etc.)
  return `${(v * 100).toFixed(2)}%`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CategoryBar({
  label,
  score,
  max,
  isZh,
}: {
  label: string;
  score: number;
  max: number;
  isZh: boolean;
}) {
  const pct = (score / max) * 100;
  const color =
    score === max
      ? "bg-emerald-500"
      : score >= max * 0.5
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="text-gray-400">{label}</span>
        <span className="font-mono text-white tabular-nums">
          {score}/{max}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function CheckRow({ check, isZh }: { check: CheckItem; isZh: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-white/5 bg-white/5 px-2 py-1.5">
      {check.passed ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
      ) : (
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-white">
          {isZh ? check.name_zh : check.name}
        </p>
        <p className="truncate text-[10px] text-gray-500">{check.note}</p>
        {check.value != null && (
          <p className="mt-0.5 font-mono text-[10px] text-gray-400">
            {isZh ? "当期" : "Curr"}: {formatValue(check.value)}
            {check.prior_value != null && (
              <>
                {" "}
                · {isZh ? "去年" : "Prior"}: {formatValue(check.prior_value)}
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main Card ─────────────────────────────────────────────────────────────────

export function QualityScoreCard({ symbol }: { symbol: string }) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const [data, setData] = useState<FScoreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/quality/fscore/${symbol}`);
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          msg =
            typeof body?.detail === "string"
              ? body.detail
              : JSON.stringify(body);
        } catch {
          msg = await res.text();
        }
        throw new Error(msg);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
        <div className="mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-white">
            {isZh ? "财务质量评分（F-Score）" : "Quality Score (F-Score)"}
          </span>
        </div>
        <div className="h-32 animate-pulse rounded bg-white/5" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
        <div className="mb-2 flex items-center gap-2">
          <Shield className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-white">
            {isZh ? "财务质量评分（F-Score）" : "Quality Score (F-Score)"}
          </span>
        </div>
        <p className="text-xs text-gray-500">
          {error
            ? isZh
              ? `数据不足：${error.slice(0, 150)}`
              : `Insufficient data: ${error.slice(0, 150)}`
            : isZh
              ? "暂无数据"
              : "No data"}
        </p>
        {error && (
          <button
            onClick={load}
            className="mt-2 text-[11px] text-cyan-300 hover:underline"
          >
            {isZh ? "重试" : "Retry"}
          </button>
        )}
      </div>
    );
  }

  // Not applicable (banks etc)
  if (!data.applicable) {
    return (
      <div className="rounded-2xl border border-slate-500/20 bg-slate-500/5 p-5 backdrop-blur">
        <div className="mb-2 flex items-center gap-2">
          <Shield className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-semibold text-white">
            {isZh ? "财务质量评分" : "Quality Score"}
          </span>
          <span className="ml-auto text-[10px] text-gray-500">
            {data.sector}
          </span>
        </div>
        {data.warnings.map((w, i) => (
          <div
            key={i}
            className="flex items-start gap-2 rounded-md bg-slate-500/10 px-3 py-2"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <p className="text-[11px] text-gray-400">{w}</p>
          </div>
        ))}
      </div>
    );
  }

  // Rating colors
  const ratingConfig = {
    high_quality: {
      color: "text-emerald-300",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/40",
      label: isZh ? "高质量" : "High Quality",
      icon: Award,
    },
    neutral: {
      color: "text-amber-300",
      bg: "bg-amber-500/10",
      border: "border-amber-500/40",
      label: isZh ? "中性" : "Neutral",
      icon: Shield,
    },
    low_quality: {
      color: "text-red-300",
      bg: "bg-red-500/10",
      border: "border-red-500/40",
      label: isZh ? "低质量" : "Low Quality",
      icon: AlertTriangle,
    },
    not_applicable: {
      color: "text-slate-300",
      bg: "bg-slate-500/10",
      border: "border-slate-500/40",
      label: "N/A",
      icon: AlertTriangle,
    },
  };

  const cfg = ratingConfig[data.rating];
  const RatingIcon = cfg.icon;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-white">
            {isZh
              ? "财务质量评分（Piotroski F-Score）"
              : "Quality Score (F-Score)"}
          </span>
        </div>
        <span className="text-[10px] text-gray-500">
          {data.sector ?? (isZh ? "未知行业" : "Unknown")}
        </span>
      </div>

      {/* Main result */}
      <div className={`mb-3 rounded-xl border-2 p-4 ${cfg.border} ${cfg.bg}`}>
        <div className="flex items-center justify-between">
          <div>
            <p
              className={`mb-0.5 flex items-center gap-1 text-xs font-medium ${cfg.color}`}
            >
              <RatingIcon className="h-3 w-3" />
              {cfg.label}
            </p>
            <p className="font-mono text-3xl font-bold text-white">
              {data.score}
              <span className="text-lg text-gray-500">/{data.max_score}</span>
            </p>
            <p className="mt-0.5 text-[10px] text-gray-400">
              {isZh ? "9 项财务健康度检验" : "9-point financial health"}
            </p>
          </div>
          <div className="text-right text-[10px] text-gray-400">
            <p className="mb-1">{isZh ? "评级阈值" : "Thresholds"}</p>
            <p className="text-emerald-400">
              {isZh ? "8-9 高质量" : "8-9 High"}
            </p>
            <p className="text-amber-400">
              {isZh ? "5-7 中性" : "5-7 Neutral"}
            </p>
            <p className="text-red-400">{isZh ? "0-4 低质量" : "0-4 Low"}</p>
          </div>
        </div>
      </div>

      {/* Category breakdown */}
      <div className="mb-3 space-y-2">
        <CategoryBar
          label={isZh ? "盈利能力" : "Profitability"}
          score={data.category_scores.profitability}
          max={4}
          isZh={isZh}
        />
        <CategoryBar
          label={isZh ? "杠杆/流动性" : "Leverage / Liquidity"}
          score={data.category_scores.leverage_liquidity}
          max={3}
          isZh={isZh}
        />
        <CategoryBar
          label={isZh ? "运营效率" : "Operating Efficiency"}
          score={data.category_scores.operating_efficiency}
          max={2}
          isZh={isZh}
        />
      </div>

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <div className="mb-3 space-y-1">
          {data.warnings.map((w, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
              <p className="text-[10px] text-amber-300">{w}</p>
            </div>
          ))}
        </div>
      )}

      {/* Show / hide details */}
      <button
        onClick={() => setShowDetails((s) => !s)}
        className="flex w-full items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] font-medium text-cyan-300 transition-colors hover:bg-white/10"
      >
        {showDetails ? (
          <>
            <ChevronUp className="h-3 w-3" />
            {isZh ? "收起 9 项详情" : "Hide 9 Checks"}
          </>
        ) : (
          <>
            <ChevronDown className="h-3 w-3" />
            {isZh ? "展开 9 项详情" : "Show 9 Checks"}
          </>
        )}
      </button>

      {showDetails && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold text-gray-400 uppercase">
              {isZh ? "盈利能力" : "Profitability"} (4)
            </p>
            <div className="space-y-1.5">
              {data.profitability.map((c, i) => (
                <CheckRow key={i} check={c} isZh={isZh} />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-semibold text-gray-400 uppercase">
              {isZh ? "杠杆 / 流动性" : "Leverage / Liquidity"} (3)
            </p>
            <div className="space-y-1.5">
              {data.leverage_liquidity.map((c, i) => (
                <CheckRow key={i} check={c} isZh={isZh} />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-semibold text-gray-400 uppercase">
              {isZh ? "运营效率" : "Operating Efficiency"} (2)
            </p>
            <div className="space-y-1.5">
              {data.operating_efficiency.map((c, i) => (
                <CheckRow key={i} check={c} isZh={isZh} />
              ))}
            </div>
          </div>
          <p className="text-[9px] text-gray-600">
            {isZh ? "* F-Score 检验" : "* F-Score checks "}
            <strong>
              {isZh ? "同比改善方向" : "year-over-year improvement"}
            </strong>
            {isZh
              ? "，不是绝对水平。高速增长公司的指标暂时下降不一定坏"
              : ", not absolute level. Growth companies may temporarily score lower"}
          </p>
        </div>
      )}
    </div>
  );
}
