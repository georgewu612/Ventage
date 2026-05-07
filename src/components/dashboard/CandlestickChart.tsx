"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
} from "lightweight-charts";
import { Maximize2, Minimize2, X } from "lucide-react";

import { useI18n } from "@/lib/i18n/provider";
import type { TechnicalData } from "@/lib/hooks/useTechnicalAnalysis";

export interface SRLevel {
  price: number;
  touch_count: number;
  strength: "weak" | "medium" | "strong" | "key";
  weekly_confluent?: boolean;
}

export interface FibLevel {
  pct: string; // e.g. "23.6", "38.2", "50.0", "61.8", "78.6"
  price: number;
}

interface Props {
  data: TechnicalData;
  height?: number;
  showVolume?: boolean;
  showBollinger?: boolean;
  showSMA?: boolean;
  supportLevels?: SRLevel[];
  resistLevels?: SRLevel[];
  fibLevels?: FibLevel[];
}

// ── Linear regression channel (client-side) ──────────────────────────────────

function computeRegressionChannel(
  candles: { time: number; close: number }[],
  lookback = 60,
  bandSigma = 2,
): {
  mid: { time: number; value: number }[];
  upper: { time: number; value: number }[];
  lower: { time: number; value: number }[];
} | null {
  const n = candles.length;
  if (n < 20) return null;
  const slice = candles.slice(Math.max(0, n - lookback));
  const m = slice.length;
  let sumX = 0,
    sumY = 0;
  for (let i = 0; i < m; i++) {
    sumX += i;
    sumY += slice[i].close;
  }
  const meanX = sumX / m;
  const meanY = sumY / m;
  let num = 0,
    den = 0;
  for (let i = 0; i < m; i++) {
    num += (i - meanX) * (slice[i].close - meanY);
    den += (i - meanX) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  let sumSq = 0;
  for (let i = 0; i < m; i++) {
    const r = slice[i].close - (slope * i + intercept);
    sumSq += r * r;
  }
  const std = Math.sqrt(sumSq / m);
  return {
    mid: slice.map((c, i) => ({
      time: c.time,
      value: slope * i + intercept,
    })),
    upper: slice.map((c, i) => ({
      time: c.time,
      value: slope * i + intercept + bandSigma * std,
    })),
    lower: slice.map((c, i) => ({
      time: c.time,
      value: slope * i + intercept - bandSigma * std,
    })),
  };
}

// ── Toggle chip ──────────────────────────────────────────────────────────────

function ToggleChip({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color: "emerald" | "red" | "purple" | "violet" | "cyan" | "amber" | "slate";
}) {
  const colorMap: Record<string, { on: string; off: string }> = {
    emerald: {
      on: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
      off: "border-slate-700 text-slate-500 hover:border-emerald-500/30 hover:text-emerald-400",
    },
    red: {
      on: "bg-red-500/20 text-red-300 border-red-500/40",
      off: "border-slate-700 text-slate-500 hover:border-red-500/30 hover:text-red-400",
    },
    purple: {
      on: "bg-purple-500/20 text-purple-300 border-purple-500/40",
      off: "border-slate-700 text-slate-500 hover:border-purple-500/30 hover:text-purple-400",
    },
    violet: {
      on: "bg-violet-500/20 text-violet-300 border-violet-500/40",
      off: "border-slate-700 text-slate-500 hover:border-violet-500/30 hover:text-violet-400",
    },
    cyan: {
      on: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
      off: "border-slate-700 text-slate-500 hover:border-cyan-500/30 hover:text-cyan-400",
    },
    amber: {
      on: "bg-amber-500/20 text-amber-300 border-amber-500/40",
      off: "border-slate-700 text-slate-500 hover:border-amber-500/30 hover:text-amber-400",
    },
    slate: {
      on: "bg-slate-500/20 text-slate-200 border-slate-500/40",
      off: "border-slate-700 text-slate-500 hover:border-slate-400 hover:text-slate-300",
    },
  };
  const cls = active ? colorMap[color].on : colorMap[color].off;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${cls}`}
    >
      {active ? "● " : "○ "}
      {label}
    </button>
  );
}

export function CandlestickChart({
  data,
  height = 420,
  showVolume: defaultShowVolume = true,
  showBollinger: defaultShowBollinger = true,
  showSMA: defaultShowSMA = true,
  supportLevels = [],
  resistLevels = [],
  fibLevels = [],
}: Props) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  // Toggle state — defaults to props (or true), user overrides per session
  const [showSupport, setShowSupport] = useState(true);
  const [showResist, setShowResist] = useState(true);
  const [showFib, setShowFib] = useState(true);
  const [showChannel, setShowChannel] = useState(false);
  const [showBB, setShowBB] = useState(defaultShowBollinger);
  const [showSMALine, setShowSMALine] = useState(defaultShowSMA);
  const [showVolBars, setShowVolBars] = useState(defaultShowVolume);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Esc to exit fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while fullscreen
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullscreen]);

  const channelData = useMemo(
    () =>
      showChannel
        ? computeRegressionChannel(
            data.candles.map((c) => ({ time: c.time, close: c.close })),
            60,
            2,
          )
        : null,
    [showChannel, data.candles],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.candles.length === 0) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const effectiveHeight = isFullscreen
      ? Math.max(
          (typeof window !== "undefined" ? window.innerHeight : 800) - 180,
          500,
        )
      : height;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: effectiveHeight,
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
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.1)",
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.1)",
        timeVisible: false,
      },
    });

    chartRef.current = chart;

    // Candlestick series — autoscaleInfoProvider ignores price lines
    // so S/R lines outside the candle range don't stretch the Y-axis
    const candleSeries = chart.addSeries(CandlestickSeries, {
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
        // Add a small margin above/below the candle range without stretching to price lines
        return {
          priceRange: res.priceRange,
          margins: { above: 0.1, below: 0.1 },
        };
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    candleSeries.setData(data.candles as any);

    // Bollinger Bands
    if (showBB && data.indicators.bb_upper.length > 0) {
      const bbUpper = chart.addSeries(LineSeries, {
        color: "rgba(147,51,234,0.4)",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bbUpper.setData(data.indicators.bb_upper as any);

      const bbLower = chart.addSeries(LineSeries, {
        color: "rgba(147,51,234,0.4)",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bbLower.setData(data.indicators.bb_lower as any);

      const bbMid = chart.addSeries(LineSeries, {
        color: "rgba(147,51,234,0.2)",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bbMid.setData(data.indicators.bb_mid as any);
    }

    // SMA lines
    if (showSMALine) {
      if (data.indicators.sma_20.length > 0) {
        const sma20 = chart.addSeries(LineSeries, {
          color: "#f59e0b",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sma20.setData(data.indicators.sma_20 as any);
      }
      if (data.indicators.sma_50.length > 0) {
        const sma50 = chart.addSeries(LineSeries, {
          color: "#06b6d4",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sma50.setData(data.indicators.sma_50 as any);
      }
    }

    // ── Support / Resistance price lines ──────────────────────────────────────
    const strengthOpacity: Record<string, number> = {
      key: 0.95,
      strong: 0.75,
      medium: 0.55,
      weak: 0.35,
    };
    const strengthWidth: Record<string, 1 | 2> = {
      key: 2,
      strong: 2,
      medium: 1,
      weak: 1,
    };
    const strengthStyle: Record<string, 0 | 1 | 2 | 3 | 4> = {
      key: 0,
      strong: 0,
      medium: 2,
      weak: 2,
    };

    // Support lines — green
    // axisLabelVisible:false prevents the right-axis label from pulling the
    // price scale to include distant levels outside the candle range.
    // weekly_confluent levels get a brighter color and solid line regardless of strength.
    if (showSupport) {
      supportLevels.forEach((level) => {
        const op = level.weekly_confluent
          ? 1.0
          : (strengthOpacity[level.strength] ?? 0.5);
        const lw = level.weekly_confluent
          ? 2
          : (strengthWidth[level.strength] ?? 1);
        const ls = level.weekly_confluent
          ? 0
          : (strengthStyle[level.strength] ?? 2);
        candleSeries.createPriceLine({
          price: level.price,
          color: `rgba(16,185,129,${op})`,
          lineWidth: lw,
          lineStyle: ls,
          axisLabelVisible: false,
          title: level.weekly_confluent
            ? `S★ ${level.price}`
            : `S ${level.price}`,
        });
      });
    }

    // Resistance lines — red
    if (showResist) {
      resistLevels.forEach((level) => {
        const op = level.weekly_confluent
          ? 1.0
          : (strengthOpacity[level.strength] ?? 0.5);
        const lw = level.weekly_confluent
          ? 2
          : (strengthWidth[level.strength] ?? 1);
        const ls = level.weekly_confluent
          ? 0
          : (strengthStyle[level.strength] ?? 2);
        candleSeries.createPriceLine({
          price: level.price,
          color: `rgba(239,68,68,${op})`,
          lineWidth: lw,
          lineStyle: ls,
          axisLabelVisible: false,
          title: level.weekly_confluent
            ? `R★ ${level.price}`
            : `R ${level.price}`,
        });
      });
    }

    // Fibonacci retracement levels — purple, dotted, fills mid-range gaps
    // when price has moved through a zone with no swing-pivot anchors.
    if (showFib) {
      const fibPctToOpacity: Record<string, number> = {
        "23.6": 0.4,
        "38.2": 0.7,
        "50.0": 0.85, // golden zone
        "50": 0.85,
        "61.8": 0.7,
        "78.6": 0.4,
      };
      fibLevels.forEach((fib) => {
        const op = fibPctToOpacity[fib.pct] ?? 0.5;
        const isGolden =
          fib.pct === "50.0" ||
          fib.pct === "50" ||
          fib.pct === "38.2" ||
          fib.pct === "61.8";
        candleSeries.createPriceLine({
          price: fib.price,
          color: `rgba(168, 85, 247, ${op})`, // purple
          lineWidth: 1,
          lineStyle: 3, // dotted
          axisLabelVisible: false,
          title: isGolden ? `Fib ${fib.pct}% ★` : `Fib ${fib.pct}%`,
        });
      });
    }

    // Trend channel — linear regression line ± 2σ bands (saturated cyan)
    if (showChannel && channelData) {
      const midSeries = chart.addSeries(LineSeries, {
        color: "rgb(8, 145, 178)", // cyan-600 fully opaque
        lineWidth: 3,
        lineStyle: 0, // solid
        priceLineVisible: false,
        lastValueVisible: false,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      midSeries.setData(channelData.mid as any);

      const upperSeries = chart.addSeries(LineSeries, {
        color: "rgb(14, 165, 233)", // sky-500
        lineWidth: 2,
        lineStyle: 2, // dashed
        priceLineVisible: false,
        lastValueVisible: false,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      upperSeries.setData(channelData.upper as any);

      const lowerSeries = chart.addSeries(LineSeries, {
        color: "rgb(14, 165, 233)", // sky-500
        lineWidth: 2,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lowerSeries.setData(channelData.lower as any);
    }

    // Volume histogram
    if (showVolBars) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
        lastValueVisible: false,
        priceLineVisible: false,
      });

      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });

      volumeSeries.setData(
        data.candles.map((c) => ({
          time: c.time,
          value: c.volume,
          color:
            c.close >= c.open
              ? "rgba(16,185,129,0.25)"
              : "rgba(239,68,68,0.25)",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        })) as any,
      );
    }

    chart.timeScale().fitContent();

    // Resize handler
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
  }, [
    data,
    height,
    isFullscreen,
    showVolBars,
    showBB,
    showSMALine,
    showSupport,
    showResist,
    showFib,
    showChannel,
    channelData,
    supportLevels,
    resistLevels,
    fibLevels,
  ]);

  // ── Toggle row + chart container ──────────────────────────────────────────
  const wrapperCls = isFullscreen
    ? "fixed inset-0 z-50 flex flex-col bg-slate-900 p-6 backdrop-blur"
    : "w-full";

  return (
    <div className={wrapperCls}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-slate-500">
          {isZh ? "图层" : "Layers"}:
        </span>
        <ToggleChip
          label={isZh ? "支撑" : "Support"}
          active={showSupport}
          onClick={() => setShowSupport(!showSupport)}
          color="emerald"
        />
        <ToggleChip
          label={isZh ? "压力" : "Resistance"}
          active={showResist}
          onClick={() => setShowResist(!showResist)}
          color="red"
        />
        <ToggleChip
          label={isZh ? "斐波那契" : "Fibonacci"}
          active={showFib}
          onClick={() => setShowFib(!showFib)}
          color="purple"
        />
        <ToggleChip
          label={isZh ? "趋势通道" : "Trend Channel"}
          active={showChannel}
          onClick={() => setShowChannel(!showChannel)}
          color="cyan"
        />
        <ToggleChip
          label={isZh ? "布林带" : "Bollinger"}
          active={showBB}
          onClick={() => setShowBB(!showBB)}
          color="violet"
        />
        <ToggleChip
          label={isZh ? "均线" : "SMA"}
          active={showSMALine}
          onClick={() => setShowSMALine(!showSMALine)}
          color="amber"
        />
        <ToggleChip
          label={isZh ? "成交量" : "Volume"}
          active={showVolBars}
          onClick={() => setShowVolBars(!showVolBars)}
          color="slate"
        />
        <button
          type="button"
          onClick={() => setIsFullscreen((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-slate-700 px-2.5 py-0.5 text-[11px] font-medium text-slate-400 transition hover:border-cyan-500/40 hover:text-cyan-400"
          title={isFullscreen ? "退出全屏 (Esc)" : "全屏放大"}
        >
          {isFullscreen ? (
            <>
              <Minimize2 className="h-3 w-3" />
              {isZh ? "退出" : "Exit"}
            </>
          ) : (
            <>
              <Maximize2 className="h-3 w-3" />
              {isZh ? "放大" : "Maximize"}
            </>
          )}
        </button>
        {isFullscreen && (
          <button
            type="button"
            onClick={() => setIsFullscreen(false)}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close fullscreen"
            title="Esc"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div
        ref={containerRef}
        className={isFullscreen ? "w-full flex-1" : "w-full"}
      />
    </div>
  );
}
