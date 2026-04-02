"use client";

import { useCallback, useState } from "react";

import { API_BASE_URL } from "@/lib/config";

export type AlertCandidate = {
  id: string;
  symbol: string;
  module: string;
  signal_type: string;
  signal_score: number;
  summary: string;
  created_at: string;
  reasons: string[];
};

export type AlertsPreviewResponse = {
  total_candidates: number;
  threshold: number;
  directions: string[];
  modules: string[];
  candidates: AlertCandidate[];
};

type AlertsPreviewRequest = {
  min_score: number;
  directions: string[];
  modules: string[];
  limit: number;
};

export function useAlertsPreview() {
  const [data, setData] = useState<AlertsPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const preview = useCallback(async (payload: AlertsPreviewRequest) => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE_URL}/v1/alerts/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Preview request failed: ${response.status}`);
      }

      const json: AlertsPreviewResponse = await response.json();
      setData(json);
      return json;
    } catch (err) {
      setError(err as Error);
      setData(null);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, preview };
}
