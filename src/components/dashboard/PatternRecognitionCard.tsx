"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { useI18n } from "@/lib/i18n/provider";
import {
  PatternMatch,
  usePatternRecognition,
} from "@/lib/hooks/usePatternRecognition";
import PatternChartModal from "./PatternChartModal";

interface Props {
  symbol: string;
}

// ── Pattern label translations ─────────────────────────────────────────────

const PATTERN_LABELS: Record<string, { zh: string; en: string }> = {
  w_bottom: { zh: "W 底", en: "W-Bottom" },
  m_top: { zh: "M 頭", en: "M-Top" },
  failed_breakdown: { zh: "破底翻", en: "Failed Breakdown" },
  failed_breakout: { zh: "假突破", en: "Failed Breakout" },
  w_bottom_with_failed_breakdown: {
    zh: "破底翻 W 底",
    en: "W-Bottom + Failed Breakdown",
  },
  head_shoulders_bottom: { zh: "頭肩底", en: "Head & Shoulders Bottom" },
  head_shoulders_top: { zh: "頭肩頂", en: "Head & Shoulders Top" },
  failed_breakout_hs_top: {
    zh: "假突破頭肩頂",
    en: "H&S Top w/ Failed Breakout",
  },
  falling_flag: { zh: "下傾旗形", en: "Falling Flag (Bull)" },
  rising_flag: { zh: "上攬旗形", en: "Rising Flag (Bear)" },
  converging_triangle_bottom: {
    zh: "收斂三角形底部",
    en: "Converging Triangle (Bullish)",
  },
  converging_triangle_top: {
    zh: "收斂三角形頂部",
    en: "Converging Triangle (Bearish)",
  },
};

const STATUS_LABELS: Record<string, { zh: string; en: string; tone: string }> =
  {
    forming: { zh: "成型中", en: "Forming", tone: "amber" },
    confirmed: { zh: "已突破", en: "Confirmed", tone: "emerald" },
    broken: { zh: "已失效", en: "Broken", tone: "red" },
  };

// ── Helpers ────────────────────────────────────────────────────────────────

function pct(v: number, decimals = 1): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(decimals)}%`;
}

function priceFmt(v: number): string {
  return `$${v.toFixed(2)}`;
}

function qualityTone(score: number): string {
  if (score >= 80) return "text-emerald-400";
  if (score >= 65) return "text-cyan-400";
  if (score >= 50) return "text-amber-400";
  return "text-slate-400";
}

function statusBadge(
  status: string,
  isZh: boolean,
): { label: string; cls: string } {
  const meta = STATUS_LABELS[status] ?? STATUS_LABELS.forming;
  const tone = meta.tone;
  const cls =
    {
      emerald: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
      amber: "bg-amber-500/20 text-amber-300 border-amber-500/40",
      red: "bg-red-500/20 text-red-300 border-red-500/40",
    }[tone] ?? "bg-slate-500/20 text-slate-300 border-slate-500/40";
  return { label: isZh ? meta.zh : meta.en, cls };
}

// ── Single pattern row ─────────────────────────────────────────────────────

function PatternRow({
  m,
  lastClose,
  isZh,
  onClick,
}: {
  m: PatternMatch;
  lastClose: number | null;
  isZh: boolean;
  onClick: () => void;
}) {
  const labels = PATTERN_LABELS[m.pattern_name_en] ?? {
    zh: m.pattern_name,
    en: m.pattern_name_en,
  };
  const isLong = m.direction === "long";
  const Icon = isLong ? TrendingUp : TrendingDown;
  const dirCls = isLong ? "text-emerald-400" : "text-red-400";

  const distToNeck =
    lastClose != null ? (m.neckline_price - lastClose) / lastClose : null;

  const rr =
    Math.abs(m.target_1 - m.entry_price) /
    Math.max(Math.abs(m.entry_price - m.stop_price), 1e-9);

  const status = statusBadge(m.status, isZh);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group block w-full rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-left transition hover:border-cyan-500/50 hover:bg-slate-800/70"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${dirCls}`} />
          <h4 className="font-semibold text-white">
            {isZh ? labels.zh : labels.en}
          </h4>
          <span
            className={`rounded border px-2 py-0.5 text-xs font-medium ${status.cls}`}
          >
            {status.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`text-sm font-semibold ${qualityTone(m.pattern_quality_score)}`}
          >
            {m.pattern_quality_score.toFixed(0)}/100
          </div>
          <ChevronRight className="h-4 w-4 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-cyan-400" />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div>
          <div className="text-xs text-slate-400">
            {isZh ? "颈线" : "Neckline"}
          </div>
          <div className="font-mono text-white">
            {priceFmt(m.neckline_price)}
            {distToNeck != null && (
              <span className="ml-2 text-xs text-slate-400">
                ({pct(distToNeck)})
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-400">
            {isZh ? "入场" : "Entry"}
          </div>
          <div className="font-mono text-white">{priceFmt(m.entry_price)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">{isZh ? "止损" : "Stop"}</div>
          <div className="font-mono text-red-300">{priceFmt(m.stop_price)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">R:R</div>
          <div className="font-mono text-cyan-300">1 : {rr.toFixed(1)}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2">
          <div className="flex items-center gap-1 text-xs text-emerald-300">
            <Target className="h-3 w-3" />
            <span>{isZh ? "第一波目标" : "Target 1"}</span>
          </div>
          <div className="mt-1 font-mono text-white">
            {priceFmt(m.target_1)}{" "}
            <span className="text-xs text-slate-400">
              ({pct(m.measured_move_pct)})
            </span>
          </div>
        </div>
        {m.target_2 != null && (
          <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-2">
            <div className="flex items-center gap-1 text-xs text-emerald-300">
              <Target className="h-3 w-3" />
              <span>{isZh ? "第二波目标" : "Target 2"}</span>
            </div>
            <div className="mt-1 font-mono text-white">
              {priceFmt(m.target_2)}{" "}
              <span className="text-xs text-slate-400">
                ({pct((m.target_2 - m.entry_price) / m.entry_price)})
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span>
          {isZh ? "形态质量" : "Quality"}{" "}
          <span className={qualityTone(m.pattern_quality_score)}>
            {m.pattern_quality_score.toFixed(0)}
          </span>
        </span>
        <span>·</span>
        <span>
          {isZh ? "时间对称" : "Time Sym."}{" "}
          <span className="text-cyan-300">
            {m.time_symmetry_score.toFixed(0)}
          </span>
        </span>
        <span>·</span>
        <span className="flex items-center gap-1">
          {m.volume_confirmation ? (
            <>
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              <span>{isZh ? "带量突破" : "Volume confirmed"}</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-3 w-3 text-amber-400" />
              <span>{isZh ? "未带量" : "No volume"}</span>
            </>
          )}
        </span>
      </div>

      <div className="mt-2 text-xs text-slate-500">
        {isZh ? "失效价：" : "Invalidates at: "}
        <span className="font-mono">{priceFmt(m.invalidation_price)}</span>
        <span className="ml-2">
          ({isZh ? "颈线返回站稳" : "neckline retest fails"})
        </span>
      </div>

      <div className="mt-2 text-[10px] text-slate-500 group-hover:text-cyan-400">
        {isZh
          ? "👆 点击查看 K 线图与形态标注"
          : "👆 Click to view chart with pattern annotations"}
      </div>
    </button>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────

export default function PatternRecognitionCard({ symbol }: Props) {
  const { locale } = useI18n();
  const isZh = locale === "zh";
  const { data, loading, error } = usePatternRecognition(symbol, 120);
  const [selectedPattern, setSelectedPattern] = useState<PatternMatch | null>(
    null,
  );

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Target className="h-5 w-5 text-cyan-400" />
          {isZh ? "形态识别" : "Pattern Recognition"}
        </h3>
        <div className="text-xs text-slate-400">
          {isZh ? "蔡森《多空轉折一手抓》" : "Cai Sen — 12 patterns"}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-8 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{isZh ? "识别中…" : "Detecting patterns…"}</span>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="mb-3 text-sm text-slate-300">
            {data.n_active === 0 ? (
              <div className="rounded border border-slate-700 bg-slate-800/30 p-4 text-slate-400">
                {isZh
                  ? "当前未识别到活跃形态。"
                  : "No active chart pattern detected."}
                <div className="mt-1 text-xs text-slate-500">
                  {isZh
                    ? "形态识别需要清晰的几何结构（W底/M頭/旗形等）。"
                    : "Pattern recognition requires clear geometric structure."}
                </div>
              </div>
            ) : (
              <>
                {isZh
                  ? `当前活跃形态 ${data.n_active} 个`
                  : `${data.n_active} active pattern${data.n_active === 1 ? "" : "s"}`}
                {data.last_close != null && (
                  <span className="ml-2 text-xs text-slate-500">
                    ({isZh ? "最新收盘" : "last"} {priceFmt(data.last_close)})
                  </span>
                )}
              </>
            )}
          </div>

          {data.n_active > 0 && (
            <div className="space-y-3">
              {data.patterns.map((m, i) => (
                <PatternRow
                  key={`${m.pattern_name_en}-${i}`}
                  m={m}
                  lastClose={data.last_close}
                  isZh={isZh}
                  onClick={() => setSelectedPattern(m)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {selectedPattern && (
        <PatternChartModal
          symbol={symbol}
          pattern={selectedPattern}
          onClose={() => setSelectedPattern(null)}
        />
      )}
    </div>
  );
}
