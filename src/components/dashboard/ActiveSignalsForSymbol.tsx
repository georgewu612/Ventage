"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import Link from "next/link";

import {
  SignalDetailPanel,
  type ScoredSignalDict,
} from "@/components/dashboard/SignalDetailPanel";
import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";

interface ScanResp {
  results: Record<
    string,
    {
      regime?: string;
      candidates?: ScoredSignalDict[];
      error?: string;
    }
  >;
}

/**
 * Per-symbol "Active Signals" widget for the Stock Workbench.
 * Calls POST /v1/signals/scan with [symbol] and renders any candidates.
 */
export function ActiveSignalsForSymbol({ symbol }: { symbol: string }) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const [signals, setSignals] = useState<ScoredSignalDict[]>([]);
  const [regime, setRegime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/v1/signals/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: [symbol], include_unscored: true }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ScanResp>;
      })
      .then((d) => {
        const r = d.results[symbol] || {};
        setSignals(r.candidates || []);
        setRegime(r.regime || null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 py-8">
        <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
        <span className="ml-2 text-xs text-gray-500">
          {isZh ? "扫描信号中…" : "Scanning signals…"}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs text-gray-600">
          {isZh ? "信号扫描失败：" : "Signal scan failed: "}
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 via-transparent to-purple-500/5 p-1">
      <div className="mb-2 flex items-center justify-between px-4 pt-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-400" />
          <span className="rounded-md bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold tracking-wider text-cyan-300 uppercase">
            {isZh ? "活跃信号" : "Active Signals"}
          </span>
          {regime && (
            <span className="text-xs text-gray-500">
              · regime:{" "}
              <span className="font-mono text-cyan-300">{regime}</span>
            </span>
          )}
        </div>
        <Link
          href="/dashboard/signals"
          className="text-[11px] text-gray-500 hover:text-cyan-300"
        >
          {isZh ? "全部 →" : "All →"}
        </Link>
      </div>

      {signals.length === 0 ? (
        <div className="px-4 pt-1 pb-4">
          <p className="text-xs text-gray-500">
            {isZh
              ? "当前 4 套规则化策略均无入场信号。市场状态可能不匹配，或形态条件未满足。"
              : "No rule-based entry signal at this time. Regime mismatch or pattern not met."}
          </p>
        </div>
      ) : (
        <div className="space-y-3 p-2">
          {signals.map((s, i) => (
            <SignalDetailPanel
              key={`${s.strategy_name}-${i}`}
              signal={s}
              compact
            />
          ))}
        </div>
      )}
    </div>
  );
}
