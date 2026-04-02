"use client";

import { useCallback, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/config";

interface MarketSentiment {
  id: string;
  symbol: string;
  source: string;
  sentiment_score: number | null;
  magnitude: number | null;
  volume: number | null;
  keywords: Record<string, number> | null;
  sample_posts: Record<string, string> | null;
  analysis_window: string | null;
  created_at: string;
}

export function useMarketSentiment(limit: number = 50) {
  const [sentiments, setSentiments] = useState<MarketSentiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSentiments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `${API_BASE_URL}/v1/market-sentiment?limit=${limit}`,
      );
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      const payload = await response.json();
      setSentiments(Array.isArray(payload.items) ? payload.items : []);
    } catch (err) {
      setError(err as Error);
      setSentiments([]);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchSentiments();
    const intervalId = setInterval(fetchSentiments, 30000);
    return () => clearInterval(intervalId);
  }, [fetchSentiments]);

  return { sentiments, loading, error, refetch: fetchSentiments };
}
