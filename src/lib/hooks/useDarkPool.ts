"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/config";

export interface DarkPoolOrder {
  id: string;
  symbol: string;
  price: number;
  size: number;
  exchange: string | null;
  trade_time: string;
  value: number | null;
  created_at: string;
}

interface UseDarkPoolOptions {
  symbol?: string;
  exchange?: string;
  minValue?: number;
  limit?: number;
}

export function useDarkPool(options: UseDarkPoolOptions = {}) {
  const [orders, setOrders] = useState<DarkPoolOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (options.symbol) params.set("symbol", options.symbol);
    if (options.exchange) params.set("exchange", options.exchange);
    if (options.minValue != null)
      params.set("min_value", String(options.minValue));
    params.set("limit", String(options.limit ?? 50));
    return params.toString();
  }, [options.symbol, options.exchange, options.minValue, options.limit]);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const resp = await fetch(
        `${API_BASE_URL}/v1/dark-pool-orders?${queryString}`,
      );
      if (!resp.ok) throw new Error(`API error: ${resp.status}`);
      const payload = await resp.json();
      setOrders(Array.isArray(payload.items) ? payload.items : []);
      setTotal(payload.pagination?.total ?? 0);
    } catch (err) {
      setError(err as Error);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    fetchOrders();
    const id = setInterval(fetchOrders, 60_000);
    return () => clearInterval(id);
  }, [fetchOrders]);

  return { orders, total, loading, error, refetch: fetchOrders };
}
