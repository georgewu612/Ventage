"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/config";

export interface MarketSignal {
  id: string;
  symbol: string;
  signal_type: string;
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;
  analysis: string | null;
  factors: Record<string, unknown> | null;
  valid_until: string | null;
  created_at: string;
  module?: string;
  signal_score?: number;
  summary?: string;
}

export type SignalSummary = {
  window: string;
  total_signals: number;
  bullish: number;
  bearish: number;
  neutral: number;
  average_score: number;
  by_module: Record<string, number>;
  top_symbols: { symbol: string; count: number }[];
  put_call_ratio: number | null;
};

type UseMarketSignalsOptions = {
  symbol?: string;
  module?: string;
  minScore?: number;
  limit?: number;
  offset?: number;
};

type SignalsApiResponse = {
  items: MarketSignal[];
  pagination: {
    limit: number;
    offset: number;
    returned: number;
    total: number;
  };
};

export function useMarketSignals(options: UseMarketSignalsOptions = {}) {
  const [signals, setSignals] = useState<MarketSignal[]>([]);
  const [summary, setSummary] = useState<SignalSummary | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (options.symbol) params.set("symbol", options.symbol.toUpperCase());
    if (options.module) params.set("module", options.module);
    if (typeof options.minScore === "number")
      params.set("min_score", String(options.minScore));
    params.set("limit", String(options.limit ?? 20));
    params.set("offset", String(options.offset ?? 0));
    return params.toString();
  }, [
    options.limit,
    options.minScore,
    options.module,
    options.offset,
    options.symbol,
  ]);

  const fetchSignals = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [signalsRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE_URL}/v1/signals?${queryString}`),
        fetch(`${API_BASE_URL}/v1/signals/summary`),
      ]);

      if (!signalsRes.ok) {
        throw new Error(`Signals API request failed: ${signalsRes.status}`);
      }

      const signalsPayload: SignalsApiResponse = await signalsRes.json();
      setSignals(
        Array.isArray(signalsPayload.items) ? signalsPayload.items : [],
      );
      setTotal(signalsPayload.pagination?.total ?? 0);

      if (summaryRes.ok) {
        const summaryPayload: SignalSummary = await summaryRes.json();
        setSummary(summaryPayload);
      } else {
        setSummary(null);
      }
    } catch (err) {
      setError(err as Error);
      setSignals([]);
      setSummary(null);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    fetchSignals();
    const intervalId = setInterval(fetchSignals, 30000);
    return () => clearInterval(intervalId);
  }, [fetchSignals]);

  return { signals, summary, total, loading, error, refetch: fetchSignals };
}
