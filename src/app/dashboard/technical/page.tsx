"use client";

import { useState } from "react";

import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Search,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { CandlestickChart } from "@/components/dashboard/CandlestickChart";
import { useTechnicalAnalysis } from "@/lib/hooks/useTechnicalAnalysis";
import { useI18n } from "@/lib/i18n/provider";

const POPULAR_SYMBOLS = [
  "AAPL",
  "MSFT",
  "NVDA",
  "TSLA",
  "AMZN",
  "META",
  "GOOGL",
  "AMD",
];

const PERIODS = [
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "1y", label: "1Y" },
  { value: "2y", label: "2Y" },
];

function formatPrice(val: number | null): string {
  if (val === null) return "-";
  return `$${val.toFixed(2)}`;
}

function formatVolume(val: number): string {
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)}K`;
  return val.toString();
}

function IndicatorBadge({
  label,
  value,
  direction,
}: {
  label: string;
  value: string;
  direction: "bullish" | "bearish" | "neutral";
}) {
  const colors = {
    bullish: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    bearish: "border-red-500/20 bg-red-500/10 text-red-400",
    neutral: "border-yellow-500/20 bg-yellow-500/10 text-yellow-400",
  };
  const Icon =
    direction === "bullish"
      ? TrendingUp
      : direction === "bearish"
        ? TrendingDown
        : Activity;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${colors[direction]}`}
    >
      <Icon className="h-4 w-4" />
      <div>
        <p className="text-xs opacity-70">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-[420px] rounded-xl bg-white/5" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg bg-white/5" />
        ))}
      </div>
    </div>
  );
}

export default function TechnicalPage() {
  const { t } = useI18n();
  const [symbol, setSymbol] = useState("NVDA");
  const [inputValue, setInputValue] = useState("NVDA");
  const [period, setPeriod] = useState("3m");
  const [showBollinger, setShowBollinger] = useState(true);
  const [showSMA, setShowSMA] = useState(true);

  const { data, loading, error } = useTechnicalAnalysis(symbol, period);

  const handleSearch = () => {
    const s = inputValue.trim().toUpperCase();
    if (s) setSymbol(s);
  };

  const rsiDirection = (rsi: number | null) => {
    if (rsi === null) return "neutral" as const;
    if (rsi > 70) return "bearish" as const;
    if (rsi < 30) return "bullish" as const;
    return "neutral" as const;
  };

  const macdDirection = (macd: number | null, sig: number | null) => {
    if (macd === null || sig === null) return "neutral" as const;
    return macd > sig ? ("bullish" as const) : ("bearish" as const);
  };

  return (
    <div>
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">
                {t("nav.technical")}
              </h1>
              <p className="mt-1 text-gray-400">{t("technical.subtitle")}</p>
            </div>
            {data && (
              <div className="text-right">
                <p className="text-2xl font-bold text-white">
                  {formatPrice(data.latest.price)}
                </p>
                <p
                  className={`flex items-center justify-end gap-1 text-sm font-medium ${
                    data.latest.change >= 0
                      ? "text-emerald-400"
                      : "text-red-400"
                  }`}
                >
                  {data.latest.change >= 0 ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )}
                  {data.latest.change >= 0 ? "+" : ""}
                  {data.latest.change.toFixed(2)} (
                  {data.latest.change_pct.toFixed(2)}%)
                </p>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Symbol search + Period selector */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder={t("technical.searchPlaceholder")}
                className="w-36 rounded-lg border border-white/10 bg-white/5 py-2 pr-3 pl-9 text-sm text-white placeholder:text-gray-500"
              />
            </div>
            <button
              onClick={handleSearch}
              className="rounded-lg bg-cyan-500/20 px-4 py-2 text-sm text-cyan-300 transition-colors hover:bg-cyan-500/30"
            >
              {t("technical.search")}
            </button>
          </div>

          {/* Quick symbols */}
          <div className="flex flex-wrap gap-1.5">
            {POPULAR_SYMBOLS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSymbol(s);
                  setInputValue(s);
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  symbol === s
                    ? "bg-cyan-500/20 text-cyan-300"
                    : "bg-white/5 text-gray-400 hover:text-white"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-1 rounded-lg border border-white/10">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  period === p.value
                    ? "bg-white/15 text-white"
                    : "text-gray-400 hover:text-white"
                } ${p.value === "1m" ? "rounded-l-lg" : ""} ${p.value === "2y" ? "rounded-r-lg" : ""}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chart overlay toggles */}
        <div className="mb-4 flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={showSMA}
              onChange={(e) => setShowSMA(e.target.checked)}
              className="accent-cyan-500"
            />
            <span className="inline-block h-2 w-4 rounded bg-amber-500" /> SMA
            20
            <span className="inline-block h-2 w-4 rounded bg-cyan-500" /> SMA 50
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={showBollinger}
              onChange={(e) => setShowBollinger(e.target.checked)}
              className="accent-purple-500"
            />
            <span className="inline-block h-2 w-4 rounded bg-purple-500/60" />{" "}
            {t("technical.bollinger")}
          </label>
        </div>

        {error ? (
          <div className="flex flex-col items-center py-20">
            <div className="mb-4 text-4xl">⚠️</div>
            <div className="text-red-400">{error.message}</div>
          </div>
        ) : loading || !data ? (
          <ChartSkeleton />
        ) : (
          <div className="animate-fade-in space-y-6">
            {/* Chart */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-cyan-400" />
                <span className="text-lg font-bold text-white">
                  ${data.symbol}
                </span>
                <span className="text-sm text-gray-400">
                  {t("technical.dailyChart")}
                </span>
              </div>
              <CandlestickChart
                data={data}
                showBollinger={showBollinger}
                showSMA={showSMA}
              />
            </div>

            {/* Indicator summary cards */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <IndicatorBadge
                label="RSI (14)"
                value={
                  data.latest.rsi !== null ? data.latest.rsi.toFixed(1) : "-"
                }
                direction={rsiDirection(data.latest.rsi)}
              />
              <IndicatorBadge
                label="MACD"
                value={
                  data.latest.macd !== null ? data.latest.macd.toFixed(2) : "-"
                }
                direction={macdDirection(
                  data.latest.macd,
                  data.latest.macd_signal,
                )}
              />
              <IndicatorBadge
                label="SMA 20"
                value={formatPrice(data.latest.sma_20)}
                direction={
                  data.latest.price && data.latest.sma_20
                    ? data.latest.price > data.latest.sma_20
                      ? "bullish"
                      : "bearish"
                    : "neutral"
                }
              />
              <IndicatorBadge
                label="SMA 50"
                value={formatPrice(data.latest.sma_50)}
                direction={
                  data.latest.price && data.latest.sma_50
                    ? data.latest.price > data.latest.sma_50
                      ? "bullish"
                      : "bearish"
                    : "neutral"
                }
              />
            </div>

            {/* Market data grid */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-gray-500">{t("technical.volume")}</p>
                <p className="text-lg font-bold text-white">
                  {formatVolume(data.latest.volume)}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-gray-500">
                  {t("technical.bbRange")}
                </p>
                <p className="text-sm font-medium text-purple-400">
                  {formatPrice(data.latest.bb_lower)} –{" "}
                  {formatPrice(data.latest.bb_upper)}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-gray-500">
                  {t("technical.high52w")}
                </p>
                <p className="text-lg font-bold text-emerald-400">
                  {formatPrice(data.latest.high_52w)}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-gray-500">{t("technical.low52w")}</p>
                <p className="text-lg font-bold text-red-400">
                  {formatPrice(data.latest.low_52w)}
                </p>
              </div>
            </div>

            {/* Technical signals */}
            {data.signals.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                <h3 className="mb-3 text-sm font-semibold text-gray-300">
                  {t("technical.signals")}
                </h3>
                <div className="space-y-2">
                  {data.signals.map((sig, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          sig.direction === "bullish"
                            ? "bg-emerald-400"
                            : "bg-red-400"
                        }`}
                      />
                      <span className="font-medium text-white">
                        {sig.indicator}
                      </span>
                      <span className="text-gray-400">
                        {t(`technical.sig.${sig.signal}`) || sig.signal}
                      </span>
                      <span
                        className={`ml-auto text-xs font-semibold ${
                          sig.direction === "bullish"
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {sig.direction === "bullish"
                          ? t("signal.bullish")
                          : t("signal.bearish")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
