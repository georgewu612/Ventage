"use client";

import { useCallback, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/config";

type TableStatus = {
  table: string;
  total: number;
  latest_created_at: string | null;
  lag_seconds: number | null;
};

export type CollectorStatus = {
  job: string;
  status: "success" | "error" | "never";
  ran_at: string | null;
  lag_seconds: number | null;
  duration_ms: number | null;
  error_message: string | null;
};

export type SystemStatus = {
  status: "ok" | "degraded";
  checked_at: string;
  healthy_tables: number;
  total_tables: number;
  tables: TableStatus[];
  collectors: CollectorStatus[];
};

export function useSystemStatus() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE_URL}/v1/system/status`);
      if (!response.ok) {
        throw new Error(`System status request failed: ${response.status}`);
      }
      const payload: SystemStatus = await response.json();
      setStatus(payload);
    } catch (err) {
      setError(err as Error);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const intervalId = setInterval(fetchStatus, 60000);
    return () => clearInterval(intervalId);
  }, [fetchStatus]);

  return { status, loading, error, refetch: fetchStatus };
}
