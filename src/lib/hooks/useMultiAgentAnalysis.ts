"use client";

import { useCallback, useState } from "react";

import { API_BASE_URL } from "@/lib/config";

export interface MultiAgentResult {
  symbol: string;
  date: string;
  decision: string;
  generated_at: string;
  model: string;
  fundamentals_report?: string;
  sentiment_report?: string;
  news_report?: string;
  technical_report?: string;
  bull_report?: string;
  bear_report?: string;
  risk_report?: string;
  trader_decision?: string;
}

export function useMultiAgentAnalysis() {
  const [result, setResult] = useState<MultiAgentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const analyze = useCallback(async (symbol: string) => {
    if (!symbol) return;
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `${API_BASE_URL}/v1/reports/multi-agent/${symbol.toUpperCase()}`,
      );
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(
          detail.detail || `API request failed: ${response.status}`,
        );
      }
      const payload = await response.json();
      setResult(payload);
    } catch (err) {
      setError(err as Error);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, loading, error, analyze };
}
