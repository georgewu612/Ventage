"use client";

import { useEffect, useState } from "react";

export interface MarketRegime {
  id: string;
  regime: "risk_on" | "neutral" | "risk_off";
  volatility: "low" | "normal" | "high" | "very_high";
  breadth: "healthy" | "narrow" | "weak";
  style: "growth" | "value" | "defensive" | "cyclical" | "mixed";
  recommendation: "offense" | "neutral" | "defense";
  confidence: number;
  vix: number | null;
  spy_vs_200ma_pct: number | null;
  rsp_spy_ratio: number | null;
  qqq_iwm_ratio: number | null;
  put_call_ratio: number | null;
  chief_summary: string;
  chief_summary_en: string;
  generated_at: string;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://faithful-simplicity-production-3a01.up.railway.app";

export function useMarketRegime(): {
  regime: MarketRegime | null;
  loading: boolean;
  error: string | null;
} {
  const [regime, setRegime] = useState<MarketRegime | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchRegime() {
      try {
        const res = await fetch(`${API_BASE}/v1/market/regime`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (res.status === 404) {
            // No snapshot yet — not an error, just empty
            if (!cancelled) {
              setRegime(null);
              setLoading(false);
            }
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const data: MarketRegime = await res.json();
        if (!cancelled) {
          setRegime(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
          setLoading(false);
        }
      }
    }

    fetchRegime();
    return () => {
      cancelled = true;
    };
  }, []);

  return { regime, loading, error };
}
