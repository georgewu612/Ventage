"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/config";

export interface AlertHistoryItem {
  id: string;
  symbol: string;
  module: string;
  signal_score: number | null;
  direction: string | null;
  sent_at: string;
  channel: string | null;
  alert_type?: string;
}

interface UseAlertHistoryOptions {
  symbol?: string;
  module?: string;
  direction?: string;
  type?: string;
  limit?: number;
}

export function useAlertHistory(options: UseAlertHistoryOptions = {}) {
  const [alerts, setAlerts] = useState<AlertHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (options.symbol) params.set("symbol", options.symbol);
    if (options.module) params.set("module", options.module);
    if (options.direction) params.set("direction", options.direction);
    if (options.type) params.set("type", options.type);
    params.set("limit", String(options.limit ?? 50));
    return params.toString();
  }, [
    options.symbol,
    options.module,
    options.direction,
    options.type,
    options.limit,
  ]);

  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `${API_BASE_URL}/v1/alerts/history?${queryString}`,
      );
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      const payload = await response.json();
      setAlerts(Array.isArray(payload.items) ? payload.items : []);
      setTotal(payload.pagination?.total ?? 0);
    } catch (err) {
      setError(err as Error);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    fetchAlerts();
    const intervalId = setInterval(fetchAlerts, 30000);
    return () => clearInterval(intervalId);
  }, [fetchAlerts]);

  return { alerts, total, loading, error, refetch: fetchAlerts };
}
