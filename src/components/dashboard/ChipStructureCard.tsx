"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Layers,
  Loader2,
  CheckCircle2,
} from "lucide-react";

import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";

interface ChipData {
  symbol: string;
  last_close: number;
  cost_zone_position:
    | "below_cost_zone"
    | "at_lower_edge_of_cost_zone"
    | "inside_cost_zone"
    | "at_upper_edge_of_cost_zone"
    | "above_cost_zone";
  overhead_supply_density: "low" | "medium" | "high";
  below_support_density: "low" | "medium" | "high";
  chip_concentration_score: number;
  chip_migration_direction: "rising" | "falling" | "flat";
  breakout_air_pocket_score: number;
  profile_tag: string[];
  chip_warning: string[];
  score_position: number;
  score_overhead: number;
  score_support: number;
  score_concentration: number;
  score_migration: number;
  score_air_pocket: number;
  chip_score: number;
  cost_zone_low: number | null;
  cost_zone_high: number | null;
  cost_zone_center: number | null;
  poc_price: number | null;
  notes: Record<string, unknown>;
}

const POSITION_LABEL: Record<
  ChipData["cost_zone_position"],
  { zh: string; en: string; tone: string }
> = {
  below_cost_zone: { zh: "成本区下方", en: "Below Cost Zone", tone: "red" },
  at_lower_edge_of_cost_zone: {
    zh: "成本区下沿",
    en: "Lower Edge",
    tone: "amber",
  },
  inside_cost_zone: { zh: "成本区内部", en: "Inside Cost Zone", tone: "slate" },
  at_upper_edge_of_cost_zone: {
    zh: "成本区上沿",
    en: "Upper Edge",
    tone: "cyan",
  },
  above_cost_zone: { zh: "成本区上方", en: "Above Cost Zone", tone: "emerald" },
};

const DENSITY_LABEL: Record<string, { zh: string; en: string }> = {
  low: { zh: "低", en: "Low" },
  medium: { zh: "中", en: "Med" },
  high: { zh: "高", en: "High" },
};

const TAG_LABEL: Record<string, string> = {
  breakout_into_air_pocket: "突破进入真空",
  near_major_hvn: "靠近主筹码区",
  retest_of_cost_zone: "回测成本区",
  inside_balance_area: "成本区内震荡",
  support_from_cost_cluster: "成本簇支撑",
  rejection_at_supply_zone: "供给区反压",
  cost_zone_rising: "成本区上移",
  chip_concentration_high: "筹码高度集中",
  above_cost_zone: "高于成本区",
};

const WARN_LABEL: Record<string, string> = {
  breakout_into_heavy_supply: "突破撞重压区",
  trapped_supply_overhead: "上方有套牢盘",
  weak_support_below: "下方支撑薄弱",
  stretched_far_from_cost_area: "远离成本区",
  no_clear_cost_support: "无清晰成本支撑",
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

function CostZoneViz({ data }: { data: ChipData }) {
  const { last_close, cost_zone_low, cost_zone_high, poc_price } = data;
  if (!cost_zone_low || !cost_zone_high) return null;

  // Build a vertical viz: range [min, max] with cost zone highlighted, current price marker
  const all = [
    last_close,
    cost_zone_low,
    cost_zone_high,
    poc_price ?? cost_zone_high,
  ];
  const padding = (Math.max(...all) - Math.min(...all)) * 0.15;
  const vMin = Math.min(...all) - padding;
  const vMax = Math.max(...all) + padding;
  const range = vMax - vMin;
  if (range <= 0) return null;

  const pct = (price: number) => ((vMax - price) / range) * 100;
  const czTopPct = pct(cost_zone_high);
  const czBottomPct = pct(cost_zone_low);
  const czHeight = czBottomPct - czTopPct;
  const closePct = pct(last_close);
  const pocPct = poc_price ? pct(poc_price) : null;

  return (
    <div className="relative h-32 w-12 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/5">
      {/* Cost zone band */}
      <div
        className="absolute inset-x-0 bg-amber-500/30"
        style={{ top: `${czTopPct}%`, height: `${czHeight}%` }}
      />
      {/* POC line */}
      {pocPct !== null && (
        <div
          className="absolute inset-x-0 h-px bg-amber-400"
          style={{ top: `${pocPct}%` }}
        />
      )}
      {/* Current price marker */}
      <div
        className="absolute inset-x-0 h-0.5 bg-cyan-400"
        style={{ top: `${closePct}%` }}
      />
      <div
        className="absolute -right-1 h-2 w-2 rounded-full border-2 border-cyan-400 bg-slate-900"
        style={{ top: `calc(${closePct}% - 4px)` }}
      />
    </div>
  );
}

interface Props {
  symbol: string;
}

export function ChipStructureCard({ symbol }: Props) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const [data, setData] = useState<ChipData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/v1/chip/${symbol}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ChipData>;
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 py-10">
        <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
        <span className="ml-2 text-xs text-gray-500">
          {isZh ? "构建筹码结构中…" : "Building cost profile…"}
        </span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="text-sm text-gray-600">
          {isZh ? "暂无筹码结构数据" : "No chip data"} {error && `(${error})`}
        </p>
      </div>
    );
  }

  const posMeta = POSITION_LABEL[data.cost_zone_position];
  const score = data.chip_score;
  const scoreTone =
    score >= 80
      ? "emerald"
      : score >= 60
        ? "cyan"
        : score < 40
          ? "red"
          : "amber";
  const scoreColor = {
    emerald: "text-emerald-400",
    cyan: "text-cyan-400",
    amber: "text-amber-400",
    red: "text-red-400",
  }[scoreTone];
  const cardBorder =
    score >= 70
      ? "border-emerald-500/30 bg-emerald-500/5"
      : score < 40
        ? "border-red-500/30 bg-red-500/5"
        : "border-white/10 bg-white/5";

  const MigrationIcon =
    data.chip_migration_direction === "rising"
      ? ArrowUp
      : data.chip_migration_direction === "falling"
        ? ArrowDown
        : ArrowRight;

  return (
    <div className={`rounded-2xl border p-5 ${cardBorder}`}>
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">
            {isZh ? "筹码结构引擎" : "Chip Structure"}
          </h3>
          <span className="text-xs text-gray-500">· ${data.symbol}</span>
        </div>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
            posMeta.tone === "emerald"
              ? "bg-emerald-500/20 text-emerald-300"
              : posMeta.tone === "cyan"
                ? "bg-cyan-500/20 text-cyan-300"
                : posMeta.tone === "amber"
                  ? "bg-amber-500/20 text-amber-300"
                  : posMeta.tone === "red"
                    ? "bg-red-500/20 text-red-300"
                    : "bg-slate-500/20 text-slate-300"
          }`}
        >
          {isZh ? posMeta.zh : posMeta.en}
        </span>
      </div>

      {/* Big score + visualization */}
      <div className="mb-4 flex items-stretch gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
        <CostZoneViz data={data} />
        <div className="flex flex-1 flex-col justify-between">
          <div>
            <p className="text-xs text-gray-500">
              {isZh ? "筹码评分" : "Chip Score"}
            </p>
            <p className={`text-3xl font-bold tabular-nums ${scoreColor}`}>
              {score.toFixed(0)}
              <span className="ml-1 text-xs text-gray-500">/100</span>
            </p>
          </div>
          <div className="space-y-0.5 text-[11px]">
            <div className="flex justify-between">
              <span className="text-gray-500">{isZh ? "当前价" : "Last"}</span>
              <span className="font-mono font-semibold text-cyan-300 tabular-nums">
                ${data.last_close.toFixed(2)}
              </span>
            </div>
            {data.cost_zone_low && data.cost_zone_high && (
              <div className="flex justify-between">
                <span className="text-gray-500">
                  {isZh ? "主成本区" : "Cost Zone"}
                </span>
                <span className="font-mono text-amber-300 tabular-nums">
                  ${data.cost_zone_low.toFixed(2)}-
                  {data.cost_zone_high.toFixed(2)}
                </span>
              </div>
            )}
            {data.poc_price && (
              <div className="flex justify-between">
                <span className="text-gray-500">POC</span>
                <span className="font-mono text-amber-300 tabular-nums">
                  ${data.poc_price.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4 key metric cards */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-white/10 bg-white/5 p-2.5">
          <p className="text-[10px] text-gray-500">
            {isZh ? "上方供给" : "Overhead"}
          </p>
          <p
            className={`text-base font-bold ${
              data.overhead_supply_density === "high"
                ? "text-red-300"
                : data.overhead_supply_density === "medium"
                  ? "text-amber-300"
                  : "text-emerald-300"
            }`}
          >
            {isZh
              ? DENSITY_LABEL[data.overhead_supply_density].zh
              : DENSITY_LABEL[data.overhead_supply_density].en}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2.5">
          <p className="text-[10px] text-gray-500">
            {isZh ? "下方支撑" : "Support"}
          </p>
          <p
            className={`text-base font-bold ${
              data.below_support_density === "high"
                ? "text-emerald-300"
                : data.below_support_density === "medium"
                  ? "text-amber-300"
                  : "text-red-300"
            }`}
          >
            {isZh
              ? DENSITY_LABEL[data.below_support_density].zh
              : DENSITY_LABEL[data.below_support_density].en}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2.5">
          <p className="text-[10px] text-gray-500">
            {isZh ? "成本迁移" : "Migration"}
          </p>
          <div className="flex items-center gap-1">
            <MigrationIcon
              className={`h-4 w-4 ${
                data.chip_migration_direction === "rising"
                  ? "text-emerald-300"
                  : data.chip_migration_direction === "falling"
                    ? "text-red-300"
                    : "text-slate-300"
              }`}
            />
            <span className="text-sm font-bold text-white">
              {data.chip_migration_direction === "rising"
                ? isZh
                  ? "上移"
                  : "Rising"
                : data.chip_migration_direction === "falling"
                  ? isZh
                    ? "下移"
                    : "Falling"
                  : isZh
                    ? "横向"
                    : "Flat"}
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2.5">
          <p className="text-[10px] text-gray-500">
            {isZh ? "突破真空区" : "Air Pocket"}
          </p>
          <p
            className={`text-base font-bold ${
              data.breakout_air_pocket_score >= 70
                ? "text-emerald-300"
                : data.breakout_air_pocket_score >= 40
                  ? "text-amber-300"
                  : "text-red-300"
            }`}
          >
            {data.breakout_air_pocket_score.toFixed(0)}
            <span className="text-[10px] text-gray-500">/100</span>
          </p>
        </div>
      </div>

      {/* 6-dim score breakdown */}
      <div className="mb-4 space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
        <p className="mb-1 text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
          {isZh ? "6 维度评分" : "6-dim Breakdown"}
        </p>
        <ScoreBar
          label={isZh ? "位置" : "Position"}
          value={data.score_position}
          max={20}
        />
        <ScoreBar
          label={isZh ? "上方供给" : "Overhead"}
          value={data.score_overhead}
          max={20}
        />
        <ScoreBar
          label={isZh ? "下方支撑" : "Support"}
          value={data.score_support}
          max={20}
          tone="emerald"
        />
        <ScoreBar
          label={isZh ? "集中度" : "Concentration"}
          value={data.score_concentration}
          max={15}
        />
        <ScoreBar
          label={isZh ? "迁移方向" : "Migration"}
          value={data.score_migration}
          max={15}
        />
        <ScoreBar
          label={isZh ? "真空区" : "Air Pocket"}
          value={data.score_air_pocket}
          max={10}
          tone="amber"
        />
      </div>

      {/* Tags */}
      {data.profile_tag.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-emerald-400 uppercase">
            <CheckCircle2 className="mr-1 inline h-3 w-3" />
            {isZh ? "结构标签" : "Profile Tags"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.profile_tag.map((t) => (
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
      {data.chip_warning.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold tracking-wider text-red-400 uppercase">
            <AlertTriangle className="h-3 w-3" />
            {isZh ? "结构警告" : "Warnings"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.chip_warning.map((w) => (
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
          ? "* Volume Profile + HVN/LVN 算法。橙色横条 = 主成本区，黄色短线 = POC，青色横线 = 当前价。"
          : "* Volume Profile + HVN/LVN. Orange band = cost zone, yellow line = POC, cyan line = current price."}
      </p>
    </div>
  );
}
