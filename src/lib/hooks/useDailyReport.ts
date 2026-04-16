"use client";

import { useCallback, useState } from "react";

import { API_BASE_URL } from "@/lib/config";

export interface DailyReport {
  market_overview: string;
  top_bullish: string;
  top_bearish: string;
  unusual_activity: string;
  risk_warning: string;
  generated_at: string;
  model: string;
  tokens: number;
}

export function useDailyReport() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const generate = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE_URL}/v1/reports/daily`);
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(
          detail.detail || `API request failed: ${response.status}`,
        );
      }
      const payload = await response.json();
      setReport(payload);
    } catch (err) {
      setError(err as Error);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return { report, loading, error, generate };
}
