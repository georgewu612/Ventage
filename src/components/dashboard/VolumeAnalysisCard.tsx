"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BarChart2,
  CheckCircle2,
  Loader2,
  XCircle,
} from "lucide-react";

import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";

interface VolumeData {
  symbol: string;
  context: Record<string, unknown> | null;
  volume_state: "very_low" | "low" | "normal" | "elevated" | "high" | "climax";
  relative_volume_5: number | null;
  relative_volume_20: number | null;
  price_volume_relation: string;
  stage_rhythm_health: "healthy" | "unhealthy" | "unclear";
  breakout_quality: "high" | "low" | null;
  exhaustion_signal: string | null;
  pullback_quality: string | null;
  volume_pattern_tag: string[];
  volume_warning: string[];
  score_state: number;
  score_rhythm: number;
  score_breakout_pullback: number;
  score_relation: number;
  score_exhaustion_risk: number;
  volume_score: number;
  volume_confirmed: boolean;
  notes: Record<string, unknown>;
}

const STATE_META: Record<
  VolumeData["volume_state"],
  { zh: string; en: string; cls: string }
> = {
  very_low: {
    zh: "极度缩量",
    en: "Very Low",
    cls: "bg-slate-500/20 text-slate-300",
  },
  low: { zh: "缩量", en: "Low", cls: "bg-slate-500/20 text-slate-300" },
  normal: { zh: "正常", en: "Normal", cls: "bg-cyan-500/20 text-cyan-300" },
  elevated: {
    zh: "放量",
    en: "Elevated",
    cls: "bg-emerald-500/20 text-emerald-300",
  },
  high: { zh: "明显放量", en: "High", cls: "bg-amber-500/20 text-amber-300" },
  climax: { zh: "爆量", en: "Climax", cls: "bg-red-500/20 text-red-300" },
};

const RELATION_LABEL: Record<string, { zh: string; en: string; tone: string }> =
  {
    up_with_volume: { zh: "价涨量增", en: "Up + Vol", tone: "emerald" },
    up_without_volume: { zh: "价涨量缩", en: "Up no Vol", tone: "amber" },
    down_with_volume: { zh: "价跌量增", en: "Down + Vol", tone: "red" },
    down_without_volume: { zh: "价跌量缩", en: "Down no Vol", tone: "slate" },
    unclear: { zh: "不明确", en: "Unclear", tone: "slate" },
  };

const TAG_LABEL: Record<string, string> = {
  breakout_volume: "突破放量",
  pullback_dryup: "回踩缩量",
  bullish_accumulation: "多头吸筹",
  bearish_distribution: "空头派发",
  absorption_volume: "承接吸量",
  climactic_reversal: "高潮反转",
  healthy_trend_volume: "趋势量健康",
};

const WARN_LABEL: Record<string, string> = {
  breakout_without_volume: "突破无量",
  weak_breakout: "弱突破",
  breakout_with_long_upper_shadow: "突破带长上影",
  pullback_on_heavy_volume: "回踩放量",
  expanding_volume_against_position: "放量逆势",
  repeated_high_volume_stall: "放量滞涨",
  consolidation_heavier_than_impulse: "整理段量大于推动段",
  intraday_breakout_failed_to_close: "盘中突破未守稳",
};

function ScoreBar({
  label,
  value,
  max,
  tone = "cyan",
}: {
  label: string;
  value: number;
  max: number;
  tone?: "cyan" | "emerald" | "amber" | "red";
}) {
  const pct = Math.min(100, (value / max) * 100);
  const cls = {
    cyan: "bg-cyan-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
  }[tone];
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-gray-500">{label}</span>
        <span className="font-mono text-gray-300 tabular-nums">
          {value.toFixed(0)}
          <span className="text-gray-600">/{max}</span>
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-700 ${cls}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface Props {
  symbol: string;
  signalType?: "breakout" | "pullback" | "sweep" | "trend" | "reversal";
  keyLevel?: number;
  direction?: "long" | "short";
}

export function VolumeAnalysisCard({
  symbol,
  signalType,
  keyLevel,
  direction = "long",
}: Props) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const [data, setData] = useState<VolumeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (signalType) params.set("signal_type", signalType);
    if (keyLevel != null) params.set("key_level", String(keyLevel));
    if (direction) params.set("direction", direction);
    const qs = params.toString();
    fetch(`${API_BASE_URL}/v1/volume/${symbol}${qs ? `?${qs}` : ""}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<VolumeData>;
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [symbol, signalType, keyLevel, direction]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 py-10">
        <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
        <span className="ml-2 text-xs text-gray-500">
          {isZh ? "成交量分析中…" : "Analyzing volume…"}
        </span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="text-sm text-gray-600">
          {isZh ? "暂无成交量数据" : "No volume data"} {error && `(${error})`}
        </p>
      </div>
    );
  }

  const stateMeta = STATE_META[data.volume_state];
  const rel =
    RELATION_LABEL[data.price_volume_relation] ?? RELATION_LABEL.unclear;
  const score = data.volume_score;
  const scoreTone =
    score >= 80
      ? "emerald"
      : score >= 65
        ? "cyan"
        : score < 50
          ? "red"
          : "amber";
  const scoreColor = {
    emerald: "text-emerald-400",
    cyan: "text-cyan-400",
    amber: "text-amber-400",
    red: "text-red-400",
  }[scoreTone];
  const cardBorder = data.volume_confirmed
    ? "border-emerald-500/30 bg-emerald-500/5"
    : data.volume_warning.length > 0
      ? "border-red-500/20 bg-red-500/5"
      : "border-white/10 bg-white/5";

  return (
    <div className={`rounded-2xl border p-5 ${cardBorder}`}>
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">
            {isZh ? "成交量引擎" : "Volume Engine"}
          </h3>
          <span className="text-xs text-gray-500">· ${data.symbol}</span>
        </div>
        <div className="flex items-center gap-2">
          {data.volume_confirmed ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-emerald-300">
              <CheckCircle2 className="h-3 w-3" />
              {isZh ? "量能确认" : "Confirmed"}
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-red-300">
              <XCircle className="h-3 w-3" />
              {isZh ? "未确认" : "Unconfirmed"}
            </span>
          )}
        </div>
      </div>

      {/* Big score + state */}
      <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
        <div>
          <p className="text-xs text-gray-500">
            {isZh ? "量能评分" : "Volume Score"}
          </p>
          <p className={`text-3xl font-bold tabular-nums ${scoreColor}`}>
            {score.toFixed(0)}
          </p>
          <p className="text-[10px] whitespace-nowrap text-gray-500">/100</p>
        </div>
        <div className="space-y-1.5">
          <div>
            <p className="mb-0.5 text-[10px] text-gray-500">
              {isZh ? "量能状态" : "State"}
            </p>
            <span
              className={`inline-flex rounded-md px-2 py-0.5 text-xs font-bold whitespace-nowrap ${stateMeta.cls}`}
            >
              {isZh ? stateMeta.zh : stateMeta.en}
            </span>
          </div>
          <div>
            <p className="mb-0.5 text-[10px] text-gray-500">
              {isZh ? "量价关系" : "Price-Vol"}
            </p>
            <span
              className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${
                rel.tone === "emerald"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : rel.tone === "red"
                    ? "bg-red-500/15 text-red-300"
                    : rel.tone === "amber"
                      ? "bg-amber-500/15 text-amber-300"
                      : "bg-slate-500/15 text-slate-300"
              }`}
            >
              {isZh ? rel.zh : rel.en}
            </span>
          </div>
        </div>
      </div>

      {/* Relative volume + rhythm */}
      <div className="mb-4 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-white/10 bg-white/5 p-2.5">
          <p className="text-[10px] whitespace-nowrap text-gray-500">
            {isZh ? "相对 5 日量" : "vs 5d avg"}
          </p>
          <p className="font-mono text-base font-bold text-white tabular-nums">
            {data.relative_volume_5?.toFixed(2) ?? "—"}×
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2.5">
          <p className="text-[10px] whitespace-nowrap text-gray-500">
            {isZh ? "相对 20 日量" : "vs 20d avg"}
          </p>
          <p className="font-mono text-base font-bold text-white tabular-nums">
            {data.relative_volume_20?.toFixed(2) ?? "—"}×
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2.5">
          <p className="text-[10px] whitespace-nowrap text-gray-500">
            {isZh ? "节奏" : "Rhythm"}
          </p>
          <p
            className={`text-base font-bold whitespace-nowrap ${
              data.stage_rhythm_health === "healthy"
                ? "text-emerald-300"
                : data.stage_rhythm_health === "unhealthy"
                  ? "text-red-300"
                  : "text-slate-300"
            }`}
          >
            {data.stage_rhythm_health === "healthy"
              ? isZh
                ? "健康"
                : "Healthy"
              : data.stage_rhythm_health === "unhealthy"
                ? isZh
                  ? "异常"
                  : "Bad"
                : isZh
                  ? "不明"
                  : "—"}
          </p>
        </div>
      </div>

      {/* Sub-score breakdown (5 dimensions) */}
      <div className="mb-4 space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
        <p className="mb-1 text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
          {isZh ? "5 维度评分" : "5-dim Breakdown"}
        </p>
        <ScoreBar
          label={isZh ? "量能状态" : "State"}
          value={data.score_state}
          max={15}
        />
        <ScoreBar
          label={isZh ? "节奏健康度" : "Rhythm"}
          value={data.score_rhythm}
          max={25}
        />
        <ScoreBar
          label={isZh ? "突破/回踩质量" : "Breakout/Pullback"}
          value={data.score_breakout_pullback}
          max={25}
        />
        <ScoreBar
          label={isZh ? "量价关系" : "Price-Vol"}
          value={data.score_relation}
          max={20}
        />
        <ScoreBar
          label={isZh ? "衰竭风险" : "Exhaustion"}
          value={data.score_exhaustion_risk}
          max={15}
          tone="amber"
        />
      </div>

      {/* Tags */}
      {data.volume_pattern_tag.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-emerald-400 uppercase">
            {isZh ? "正面标签" : "Positive Tags"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.volume_pattern_tag.map((t) => (
              <span
                key={t}
                className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300"
              >
                {TAG_LABEL[t] ?? t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {data.volume_warning.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold tracking-wider text-red-400 uppercase">
            <AlertTriangle className="h-3 w-3" />
            {isZh ? "风险警告" : "Warnings"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.volume_warning.map((w) => (
              <span
                key={w}
                className="rounded-md bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300"
              >
                {WARN_LABEL[w] ?? w}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <p className="mt-3 text-[9px] text-gray-700">
        {isZh
          ? "* 6 个判断模块（节奏/量价/突破/衰竭/回踩/状态）+ 5 维度加权评分。"
          : "* 6 judgment modules + 5-dim weighted score. Rule-based volume analysis."}
      </p>
    </div>
  );
}
