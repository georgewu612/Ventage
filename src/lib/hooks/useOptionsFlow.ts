"use client";

import { useCallback, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/config";

interface OptionsFlow {
  id: string;
  symbol: string;
  option_type: "call" | "put";
  strike: number;
  expiration: string;
  premium: number;
  volume: number;
  open_interest: number | null;
  implied_volatility: number | null;
  unusual_score: number | null;
  trade_type: string | null;
  sentiment: string | null;
  created_at: string;
}

export function useOptionsFlow(limit: number = 50) {
  const [options, setOptions] = useState<OptionsFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchOptions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `${API_BASE_URL}/v1/options-flow?limit=${limit}`,
      );
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      const payload = await response.json();
      setOptions(Array.isArray(payload.items) ? payload.items : []);
    } catch (err) {
      setError(err as Error);
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchOptions();
    const intervalId = setInterval(fetchOptions, 30000);
    return () => clearInterval(intervalId);
  }, [fetchOptions]);

  return { options, loading, error, refetch: fetchOptions };
}
