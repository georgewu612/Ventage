"use client";

import { useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://faithful-simplicity-production-3a01.up.railway.app";

export interface PortfolioPrefs {
  user_id: string;
  risk_preference:
    | "conservative"
    | "moderate"
    | "balanced"
    | "aggressive"
    | "speculative";
  max_drawdown_pct: number;
  return_preference: string;
  holding_period: string;
  trading_style: string;
  universe: string;
  sector_preferences: string[];
  risk_limits: Record<string, unknown>;
}

export interface PortfolioCandidate {
  symbol: string;
  rationale: string;
  rationale_en: string;
  weight_pct: number | null;
}

export interface BacktestSummary {
  period_days: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  win_rate_pct: number;
  symbols: string[];
}

export interface PortfolioRecommendationResult {
  id: string;
  portfolio_type: string;
  portfolio_type_en: string;
  regime_at_creation: string;
  risk_level: string;
  confidence_score: number;
  recommended_templates: string[];
  allocation_structure: { core: number; enhance: number; satellite: number };
  core_candidates: PortfolioCandidate[];
  enhance_candidates: PortfolioCandidate[];
  satellite_candidates: PortfolioCandidate[];
  watchlist_candidates: PortfolioCandidate[];
  avoid_candidates: PortfolioCandidate[];
  backtest_summary: BacktestSummary;
  ai_explanation: string;
  ai_explanation_en: string;
}

export interface RecommendationSummary {
  id: string;
  risk_preference: string;
  portfolio_type: string;
  portfolio_type_en: string;
  regime_at_creation: string;
  risk_level: string;
  confidence_score: number;
  allocation_structure: Record<string, number> | null;
  ai_explanation: string | null;
  ai_explanation_en: string | null;
  backtest_summary: Record<string, number> | null;
  created_at: string;
}

export function usePortfolioBuilder() {
  const [building, setBuilding] = useState(false);
  const [recommendation, setRecommendation] =
    useState<PortfolioRecommendationResult | null>(null);
  const [history, setHistory] = useState<RecommendationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function buildPortfolio(prefs: PortfolioPrefs) {
    setBuilding(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/portfolio/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as PortfolioRecommendationResult;
      setRecommendation(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  }

  async function fetchRecommendations(userId: string) {
    try {
      const res = await fetch(
        `${API_BASE}/v1/portfolio/recommendations?user_id=${userId}&limit=10`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setHistory(data.recommendations || []);
    } catch {
      // silently ignore
    }
  }

  function reset() {
    setRecommendation(null);
    setError(null);
  }

  return {
    building,
    recommendation,
    history,
    error,
    buildPortfolio,
    fetchRecommendations,
    reset,
  };
}
