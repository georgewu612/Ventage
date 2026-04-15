"use client";

import { useCallback, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/config";

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TimeValue {
  time: number;
  value: number;
}

interface Indicators {
  rsi: TimeValue[];
  macd_line: TimeValue[];
  macd_signal: TimeValue[];
  macd_hist: TimeValue[];
  bb_upper: TimeValue[];
  bb_mid: TimeValue[];
  bb_lower: TimeValue[];
  sma_20: TimeValue[];
  sma_50: TimeValue[];
  ema_12: TimeValue[];
}

interface LatestValues {
  price: number | null;
  change: number;
  change_pct: number;
  rsi: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  sma_20: number | null;
  sma_50: number | null;
  bb_upper: number | null;
  bb_lower: number | null;
  volume: number;
  high_52w: number | null;
  low_52w: number | null;
}

interface TechnicalSignal {
  indicator: string;
  signal: string;
  direction: "bullish" | "bearish";
}

export interface TechnicalData {
  symbol: string;
  period: string;
  candles: Candle[];
  indicators: Indicators;
  latest: LatestValues;
  signals: TechnicalSignal[];
}

export function useTechnicalAnalysis(symbol: string, period: string = "3m") {
  const [data, setData] = useState<TechnicalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    if (!symbol) return;
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `${API_BASE_URL}/v1/technical/${symbol.toUpperCase()}?period=${period}`,
      );
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(
          detail.detail || `API request failed: ${response.status}`,
        );
      }
      const payload = await response.json();
      setData(payload);
    } catch (err) {
      setError(err as Error);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [symbol, period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
