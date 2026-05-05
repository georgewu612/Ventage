"use client";

import { useCallback, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/config";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PatternPivot {
  date: string;
  price: number;
  role: string;
  idx: number;
}

export interface PatternMatch {
  pattern_name: string;
  pattern_name_en: string;
  direction: "long" | "short";
  pattern_start_date: string;
  pattern_end_date: string;
  pivot_points: PatternPivot[];
  neckline_price: number;
  neckline_date: string;
  entry_price: number;
  stop_price: number;
  target_1: number;
  target_2: number | null;
  invalidation_price: number;
  measured_move_pct: number;
  pattern_quality_score: number;
  time_symmetry_score: number;
  volume_confirmation: boolean;
  status: "forming" | "confirmed" | "broken";
}

export interface PatternResponse {
  symbol: string;
  n_active: number;
  lookback: number;
  as_of: string | null;
  last_close: number | null;
  patterns: PatternMatch[];
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePatternRecognition(symbol: string, lookback = 120) {
  const [data, setData] = useState<PatternResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPatterns = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/v1/patterns/${encodeURIComponent(symbol)}?lookback=${lookback}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
      const json: PatternResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [symbol, lookback]);

  useEffect(() => {
    void fetchPatterns();
  }, [fetchPatterns]);

  return { data, loading, error, refetch: fetchPatterns };
}
