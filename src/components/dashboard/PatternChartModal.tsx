"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import {
  X,
  TrendingDown,
  TrendingUp,
  Loader2,
  AlertCircle,
} from "lucide-react";

import { useI18n } from "@/lib/i18n/provider";
import { useTechnicalAnalysis } from "@/lib/hooks/useTechnicalAnalysis";
import type { PatternMatch } from "@/lib/hooks/usePatternRecognition";

// ── Pattern label translations (mirror PatternRecognitionCard) ─────────────

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

function priceFmt(v: number): string {
  return `$${v.toFixed(2)}`;
}

function pctFmt(v: number, decimals = 1): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(decimals)}%`;
}

// Convert ISO date "2026-01-15T00:00:00" → unix-seconds (chart's HorzScaleItem)
function isoToTime(iso: string): Time {
  return Math.floor(new Date(iso).getTime() / 1000) as Time;
}

// ── Inner chart (with annotations) ─────────────────────────────────────────

function PatternChart({
  candles,
  pattern,
  height = 460,
}: {
  candles: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
  pattern: PatternMatch;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: "transparent" },
        textColor: "#94a3b8",
        fontSize: 12,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: {
        vertLine: {
          color: "rgba(103,232,249,0.3)",
          labelBackgroundColor: "#1e293b",
        },
        horzLine: {
          color: "rgba(103,232,249,0.3)",
          labelBackgroundColor: "#1e293b",
        },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
      timeScale: {
        borderColor: "rgba(255,255,255,0.1)",
        timeVisible: false,
      },
    });
    chartRef.current = chart;

    // Candlesticks
    const candleSeries: ISeriesApi<"Candlestick"> = chart.addSeries(
      CandlestickSeries,
      {
        upColor: "#10b981",
        downColor: "#ef4444",
        borderUpColor: "#10b981",
        borderDownColor: "#ef4444",
        wickUpColor: "#10b981",
        wickDownColor: "#ef4444",
        autoscaleInfoProvider: (
          original: () => {
            priceRange: { minValue: number; maxValue: number } | null;
            margins?: { above: number; below: number };
          } | null,
        ) => {
          const res = original();
          if (!res) return res;
          return {
            priceRange: res.priceRange,
            margins: { above: 0.15, below: 0.15 },
          };
        },
      },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    candleSeries.setData(candles as any);

    // Volume histogram
    const volSeries = chart.addSeries(HistogramSeries, {
      color: "rgba(100,116,139,0.4)",
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volSeries.setData(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      candles.map((c: any) => ({
        time: c.time,
        value: c.volume,
        color:
          c.close >= c.open ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.4)",
      })) as any,
    );

    // ── Pattern price lines (entry / stop / T1 / T2 / neckline / invalidation) ──
    const isLong = pattern.direction === "long";
    candleSeries.createPriceLine({
      price: pattern.neckline_price,
      color: "rgba(103, 232, 249, 0.95)",
      lineWidth: 2,
      lineStyle: 0, // solid
      title: `Neckline ${priceFmt(pattern.neckline_price)}`,
    });
    candleSeries.createPriceLine({
      price: pattern.entry_price,
      color: "rgba(34, 211, 238, 0.85)",
      lineWidth: 2,
      lineStyle: 2, // dashed
      title: `Entry ${priceFmt(pattern.entry_price)}`,
    });
    candleSeries.createPriceLine({
      price: pattern.stop_price,
      color: "rgba(239, 68, 68, 0.9)",
      lineWidth: 2,
      lineStyle: 2,
      title: `Stop ${priceFmt(pattern.stop_price)}`,
    });
    candleSeries.createPriceLine({
      price: pattern.target_1,
      color: "rgba(16, 185, 129, 0.95)",
      lineWidth: 2,
      lineStyle: 0,
      title: `T1 ${priceFmt(pattern.target_1)} (${pctFmt(pattern.measured_move_pct)})`,
    });
    if (pattern.target_2 != null) {
      candleSeries.createPriceLine({
        price: pattern.target_2,
        color: "rgba(52, 211, 153, 0.7)",
        lineWidth: 2,
        lineStyle: 2,
        title: `T2 ${priceFmt(pattern.target_2)}`,
      });
    }
    candleSeries.createPriceLine({
      price: pattern.invalidation_price,
      color: "rgba(245, 158, 11, 0.7)",
      lineWidth: 1,
      lineStyle: 3, // dotted
      title: `Invalidation ${priceFmt(pattern.invalidation_price)}`,
    });

    // ── Pivot point markers ──
    const markers: SeriesMarker<Time>[] = pattern.pivot_points.map((p) => {
      const role = p.role;
      const isLowRole =
        role.includes("low") ||
        role.includes("breakdown") ||
        role === "support";
      const isHighRole =
        role.includes("high") ||
        role === "head" ||
        role.includes("top") ||
        role === "neckline_break";
      let position: "aboveBar" | "belowBar" | "inBar" = "inBar";
      let color = "#94a3b8";
      let shape: "circle" | "arrowUp" | "arrowDown" | "square" = "circle";

      if (isLowRole) {
        position = "belowBar";
        color = "#10b981";
        shape = "arrowUp";
      } else if (isHighRole) {
        position = "aboveBar";
        color = "#ef4444";
        shape = "arrowDown";
      } else if (role === "neckline" || role.includes("neckline")) {
        position = "aboveBar";
        color = "#67e8f9";
        shape = "circle";
      }
      return {
        time: isoToTime(p.date),
        position,
        color,
        shape,
        text: role,
        size: 1,
      };
    });
    if (markers.length > 0) {
      createSeriesMarkers(candleSeries, markers);
    }

    // Fit content to candle range
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
        });
      }
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [candles, pattern, height]);

  return <div ref={containerRef} style={{ height }} />;
}

// ── Modal ──────────────────────────────────────────────────────────────────

interface Props {
  symbol: string;
  pattern: PatternMatch;
  onClose: () => void;
}

export default function PatternChartModal({ symbol, pattern, onClose }: Props) {
  const { locale } = useI18n();
  const isZh = locale === "zh";
  const { data, loading, error } = useTechnicalAnalysis(symbol, "6m", "1d");

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const labels = PATTERN_LABELS[pattern.pattern_name_en] ?? {
    zh: pattern.pattern_name,
    en: pattern.pattern_name_en,
  };
  const isLong = pattern.direction === "long";
  const Icon = isLong ? TrendingUp : TrendingDown;
  const dirCls = isLong ? "text-emerald-400" : "text-red-400";

  const statusMeta = STATUS_LABELS[pattern.status] ?? STATUS_LABELS.forming;
  const statusCls =
    {
      emerald: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
      amber: "bg-amber-500/20 text-amber-300 border-amber-500/40",
      red: "bg-red-500/20 text-red-300 border-red-500/40",
    }[statusMeta.tone] ?? "bg-slate-500/20 text-slate-300 border-slate-500/40";

  const rr =
    Math.abs(pattern.target_1 - pattern.entry_price) /
    Math.max(Math.abs(pattern.entry_price - pattern.stop_price), 1e-9);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <Icon className={`h-6 w-6 ${dirCls}`} />
            <h2 className="text-xl font-semibold text-white">
              {symbol} · {isZh ? labels.zh : labels.en}
            </h2>
            <span
              className={`rounded border px-2 py-0.5 text-xs font-medium ${statusCls}`}
            >
              {isZh ? statusMeta.zh : statusMeta.en}
            </span>
            <span
              className={`text-sm font-semibold ${
                pattern.pattern_quality_score >= 80
                  ? "text-emerald-400"
                  : pattern.pattern_quality_score >= 65
                    ? "text-cyan-400"
                    : pattern.pattern_quality_score >= 50
                      ? "text-amber-400"
                      : "text-slate-400"
              }`}
            >
              Q {pattern.pattern_quality_score.toFixed(0)}/100
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Chart + side panel */}
        <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-[2fr_1fr]">
          {/* Chart */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            {loading && (
              <div className="flex h-[460px] items-center justify-center gap-2 text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{isZh ? "加载K线…" : "Loading chart…"}</span>
              </div>
            )}
            {error && (
              <div className="flex h-[460px] items-center justify-center gap-2 text-red-300">
                <AlertCircle className="h-4 w-4" />
                <span>
                  {error instanceof Error ? error.message : String(error)}
                </span>
              </div>
            )}
            {!loading && !error && data && data.candles.length > 0 && (
              <PatternChart candles={data.candles} pattern={pattern} />
            )}
          </div>

          {/* Side panel: trade plan + key info */}
          <div className="space-y-3">
            {/* Trade plan */}
            <div className="rounded-xl border border-slate-800 bg-slate-800/30 p-4">
              <h3 className="mb-3 text-sm font-semibold text-cyan-400">
                {isZh ? "交易计划" : "Trade Plan"}
              </h3>
              <div className="space-y-2 text-sm">
                <Row
                  label={isZh ? "颈线" : "Neckline"}
                  value={priceFmt(pattern.neckline_price)}
                  cls="text-cyan-300"
                />
                <Row
                  label={isZh ? "入场" : "Entry"}
                  value={priceFmt(pattern.entry_price)}
                  cls="text-cyan-300"
                />
                <Row
                  label={isZh ? "止损" : "Stop"}
                  value={priceFmt(pattern.stop_price)}
                  cls="text-red-300"
                />
                <Row
                  label={isZh ? "第一目标" : "Target 1"}
                  value={`${priceFmt(pattern.target_1)} (${pctFmt(pattern.measured_move_pct)})`}
                  cls="text-emerald-300"
                />
                {pattern.target_2 != null && (
                  <Row
                    label={isZh ? "第二目标" : "Target 2"}
                    value={`${priceFmt(pattern.target_2)} (${pctFmt(
                      (pattern.target_2 - pattern.entry_price) /
                        pattern.entry_price,
                    )})`}
                    cls="text-emerald-300"
                  />
                )}
                <Row
                  label={isZh ? "失效价" : "Invalidates"}
                  value={priceFmt(pattern.invalidation_price)}
                  cls="text-amber-300"
                />
                <div className="mt-2 border-t border-slate-700 pt-2">
                  <Row
                    label={isZh ? "风报比" : "Risk/Reward"}
                    value={`1 : ${rr.toFixed(2)}`}
                    cls="text-cyan-300 font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Pattern quality */}
            <div className="rounded-xl border border-slate-800 bg-slate-800/30 p-4">
              <h3 className="mb-3 text-sm font-semibold text-cyan-400">
                {isZh ? "形态评估" : "Pattern Quality"}
              </h3>
              <div className="space-y-2 text-sm">
                <Row
                  label={isZh ? "形态质量" : "Quality Score"}
                  value={`${pattern.pattern_quality_score.toFixed(0)}/100`}
                  cls="text-white font-mono"
                />
                <Row
                  label={isZh ? "时间对称" : "Time Symmetry"}
                  value={`${pattern.time_symmetry_score.toFixed(0)}/100`}
                  cls="text-cyan-300 font-mono"
                />
                <Row
                  label={isZh ? "量价配合" : "Volume Confirm"}
                  value={
                    pattern.volume_confirmation
                      ? isZh
                        ? "✅ 已配合"
                        : "✅ Confirmed"
                      : isZh
                        ? "⚠️ 未配合"
                        : "⚠️ Not yet"
                  }
                  cls={
                    pattern.volume_confirmation
                      ? "text-emerald-300"
                      : "text-amber-300"
                  }
                />
                <Row
                  label={isZh ? "形态时长" : "Pattern Span"}
                  value={`${Math.round(
                    (new Date(pattern.pattern_end_date).getTime() -
                      new Date(pattern.pattern_start_date).getTime()) /
                      (1000 * 60 * 60 * 24),
                  )} ${isZh ? "天" : "days"}`}
                  cls="text-white"
                />
              </div>
            </div>

            {/* Pivot points */}
            <div className="rounded-xl border border-slate-800 bg-slate-800/30 p-4">
              <h3 className="mb-3 text-sm font-semibold text-cyan-400">
                {isZh ? "关键枢轴点" : "Pivot Points"}
              </h3>
              <div className="space-y-1 text-xs">
                {pattern.pivot_points.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-slate-300"
                  >
                    <span className="font-mono text-slate-400">{p.role}</span>
                    <span className="font-mono">
                      {p.date.slice(0, 10)} · {priceFmt(p.price)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Source */}
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
              {isZh
                ? "📖 形态识别基于蔡森《多空轉折一手抓》12 形态法。"
                : "📖 Based on Cai Sen's 12-pattern methodology."}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 border-t border-slate-800 px-6 py-3 text-xs text-slate-400">
          <Legend
            color="rgb(103, 232, 249)"
            label={isZh ? "颈线" : "Neckline"}
            solid
          />
          <Legend color="rgb(34, 211, 238)" label={isZh ? "入场" : "Entry"} />
          <Legend color="rgb(239, 68, 68)" label={isZh ? "止损" : "Stop"} />
          <Legend color="rgb(16, 185, 129)" label="Target 1" solid />
          <Legend color="rgb(52, 211, 153)" label="Target 2" />
          <Legend
            color="rgb(245, 158, 11)"
            label={isZh ? "失效" : "Invalidates"}
            dotted
          />
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  cls = "text-white",
}: {
  label: string;
  value: string;
  cls?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className={cls}>{value}</span>
    </div>
  );
}

function Legend({
  color,
  label,
  solid,
  dotted,
}: {
  color: string;
  label: string;
  solid?: boolean;
  dotted?: boolean;
}) {
  const lineStyle = solid
    ? "border-solid"
    : dotted
      ? "border-dotted"
      : "border-dashed";
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`h-0 w-5 border-t-2 ${lineStyle}`}
        style={{ borderColor: color }}
      />
      <span>{label}</span>
    </div>
  );
}
