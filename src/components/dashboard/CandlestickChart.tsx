"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
} from "lightweight-charts";

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

export function CandlestickChart({
  data,
  height = 420,
  showVolume = true,
  showBollinger = true,
  showSMA = true,
  supportLevels = [],
  resistLevels = [],
  fibLevels = [],
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.candles.length === 0) return;

    // Clean up previous chart
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
    if (showBollinger && data.indicators.bb_upper.length > 0) {
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
    if (showSMA) {
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

    // Resistance lines — red
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

    // Fibonacci retracement levels — purple, dotted, fills mid-range gaps
    // when price has moved through a zone with no swing-pivot anchors.
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

    // Volume histogram
    if (showVolume) {
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
    showVolume,
    showBollinger,
    showSMA,
    supportLevels,
    resistLevels,
  ]);

  return <div ref={containerRef} className="w-full" />;
}
