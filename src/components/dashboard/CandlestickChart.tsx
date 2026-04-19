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

interface Props {
  data: TechnicalData;
  height?: number;
  showVolume?: boolean;
  showBollinger?: boolean;
  showSMA?: boolean;
}

export function CandlestickChart({
  data,
  height = 420,
  showVolume = true,
  showBollinger = true,
  showSMA = true,
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

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
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
  }, [data, height, showVolume, showBollinger, showSMA]);

  return <div ref={containerRef} className="w-full" />;
}
