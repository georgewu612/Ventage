"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

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
  onNewSignals?: (count: number) => void;
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
  const { onNewSignals } = options;

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

  // Supabase Realtime — listen for new signal inserts
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("market_signals_inserts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "market_signals" },
        (payload) => {
          const row = payload.new as MarketSignal;
          // Normalize module & signal_score from raw DB row
          const factors =
            typeof row.factors === "object" && row.factors !== null
              ? (row.factors as Record<string, unknown>)
              : {};
          const module =
            (row.module as string | undefined) ||
            (factors.module as string | undefined) ||
            "unknown";
          const signal_score =
            row.signal_score ?? Math.round((row.confidence ?? 0) * 100);
          const incoming: MarketSignal = {
            ...row,
            module,
            signal_score,
            summary: row.summary || row.analysis || undefined,
          };

          setSignals((prev) => {
            // Avoid duplicates
            if (prev.some((s) => s.id === incoming.id)) return prev;
            return [incoming, ...prev];
          });
          setTotal((prev) => prev + 1);
          onNewSignals?.(1);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onNewSignals]);

  return { signals, summary, total, loading, error, refetch: fetchSignals };
}
