"use client";

import { useCallback, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/config";

interface InsiderTrade {
  id: string;
  symbol: string;
  insider_name: string;
  insider_title: string | null;
  relationship: string | null;
  trade_type: "BUY" | "SELL";
  shares: number;
  price: number | null;
  value: number | null;
  shares_owned_after: number | null;
  filing_date: string;
  transaction_date: string | null;
  sec_form: string | null;
  footnotes: string | null;
  created_at: string;
}

export function useInsiderTrades(limit: number = 50) {
  const [trades, setTrades] = useState<InsiderTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTrades = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `${API_BASE_URL}/v1/insider-trades?limit=${limit}`,
      );
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      const payload = await response.json();
      setTrades(Array.isArray(payload.items) ? payload.items : []);
    } catch (err) {
      setError(err as Error);
      setTrades([]);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchTrades();
    const intervalId = setInterval(fetchTrades, 30000);
    return () => clearInterval(intervalId);
  }, [fetchTrades]);

  return { trades, loading, error, refetch: fetchTrades };
}
