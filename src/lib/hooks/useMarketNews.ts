"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/config";

export interface MarketNewsItem {
  id: string;
  source: string;
  source_id: string;
  title: string | null;
  content: string;
  channels: string[];
  importance: number;
  symbols: string[];
  published_at: string;
  created_at: string;
}

interface UseMarketNewsOptions {
  channel?: string;
  importance?: number;
  symbol?: string;
  limit?: number;
}

export function useMarketNews(options: UseMarketNewsOptions = {}) {
  const [news, setNews] = useState<MarketNewsItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (options.channel) params.set("channel", options.channel);
    if (options.importance)
      params.set("importance", String(options.importance));
    if (options.symbol) params.set("symbol", options.symbol);
    params.set("limit", String(options.limit ?? 50));
    return params.toString();
  }, [options.channel, options.importance, options.symbol, options.limit]);

  const fetchNews = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `${API_BASE_URL}/v1/market-news?${queryString}`,
      );
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      const payload = await response.json();
      setNews(Array.isArray(payload.items) ? payload.items : []);
      setTotal(payload.pagination?.total ?? 0);
    } catch (err) {
      setError(err as Error);
      setNews([]);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    fetchNews();
    const intervalId = setInterval(fetchNews, 30000);
    return () => clearInterval(intervalId);
  }, [fetchNews]);

  return { news, total, loading, error, refetch: fetchNews };
}
