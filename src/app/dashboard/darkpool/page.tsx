"use client";

import { useState } from "react";
import { Layers } from "lucide-react";

import { type DarkPoolOrder, useDarkPool } from "@/lib/hooks/useDarkPool";
import { useI18n } from "@/lib/i18n/provider";

// ── Formatters ───────────────────────────────────────────────────────────────
function formatValue(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function formatSize(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatDate(dateStr: string, locale: string): string {
  try {
    return new Date(dateStr).toLocaleString(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function valueColor(v: number | null): string {
  if (v == null) return "text-gray-400";
  if (v >= 50_000_000) return "text-purple-300";
  if (v >= 10_000_000) return "text-purple-400";
  if (v >= 5_000_000) return "text-cyan-400";
  if (v >= 1_000_000) return "text-emerald-400";
  return "text-gray-300";
}

function whaleBadge(v: number | null): string | null {
  if (v == null) return null;
  if (v >= 50_000_000) return "🐳";
  if (v >= 10_000_000) return "🐋";
  if (v >= 5_000_000) return "⭐";
  return null;
}

// ── Chart: Exchange Distribution Donut ──────────────────────────────────────
const EXCHANGE_COLORS: Record<string, string> = {
  DARK: "#a855f7",
  FINRA_OTC: "#06b6d4",
  OTHER: "#64748b",
};

function ExchangeDonut({ orders }: { orders: DarkPoolOrder[] }) {
  const byEx: Record<string, number> = {};
  for (const o of orders) {
    const ex = o.exchange ?? "OTHER";
    const key = ex.includes("FINRA")
      ? "FINRA_OTC"
      : ex.includes("DARK")
        ? "DARK"
        : "OTHER";
    byEx[key] = (byEx[key] ?? 0) + (o.value ?? 0);
  }
  const entries = Object.entries(byEx).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;

  // SVG donut — pre-compute arc offsets before render
  const r = 38;
  const cx = 50;
  const cy = 50;
  const circumference = 2 * Math.PI * r;
  const arcs = entries.map(([ex, val], i) => {
    const pct = val / total;
    const dash = pct * circumference;
    const prevDash = entries
      .slice(0, i)
      .reduce((s, [, v]) => s + (v / total) * circumference, 0);
    const dashOffset = -(prevDash - circumference / 4);
    return { ex, dash, dashOffset, color: EXCHANGE_COLORS[ex] ?? "#64748b" };
  });

  return (
    <div className="flex flex-col items-center">
      <p className="mb-3 text-xs font-medium tracking-wider text-gray-500 uppercase">
        交易所分布
      </p>
      <div className="relative">
        <svg width="100" height="100" viewBox="0 0 100 100">
          {arcs.map(({ ex, dash, dashOffset, color }) => (
            <circle
              key={ex}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth="16"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-bold text-white">{entries.length}</span>
          <span className="text-[10px] text-gray-400">交易所</span>
        </div>
      </div>
      <div className="mt-2 space-y-1">
        {entries.map(([ex, val]) => (
          <div key={ex} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: EXCHANGE_COLORS[ex] ?? "#64748b" }}
            />
            <span className="text-gray-400">{ex}</span>
            <span className="ml-auto text-gray-300">
              {((val / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Chart: Daily Value Timeline ──────────────────────────────────────────────
function DarkPoolTimeline({ orders }: { orders: DarkPoolOrder[] }) {
  const byDate: Record<string, { date: string; value: number; count: number }> =
    {};
  for (const o of orders) {
    const date = (o.trade_time ?? o.created_at).slice(0, 10);
    if (!byDate[date]) byDate[date] = { date, value: 0, count: 0 };
    byDate[date].value += o.value ?? 0;
    byDate[date].count++;
  }

  const days = Object.values(byDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  if (days.length === 0)
    return <p className="text-xs text-gray-500">暂无时间线数据</p>;

  const maxVal = Math.max(...days.map((d) => d.value), 1);

  return (
    <div>
      <p className="mb-2 text-xs font-medium tracking-wider text-gray-500 uppercase">
        每日机构暗池成交量
      </p>
      <div className="flex h-28 items-end gap-0.5">
        {days.map((day) => {
          const hPct = Math.max(4, (day.value / maxVal) * 100);
          return (
            <div
              key={day.date}
              className="group relative flex flex-1 flex-col items-center"
            >
              <div
                style={{ height: `${hPct}%` }}
                className="w-full rounded-t bg-purple-500/50 transition-colors hover:bg-purple-400/80"
              />
              {/* Tooltip */}
              <div className="pointer-events-none absolute bottom-full mb-1 hidden rounded bg-slate-800 px-2 py-1 text-center text-[10px] text-white shadow-lg group-hover:block">
                <div className="font-semibold">{formatValue(day.value)}</div>
                <div className="text-gray-400">{day.date}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-gray-600">
        <span>{days[0]?.date}</span>
        <span>{days[days.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// ── Whale Prints Highlight ───────────────────────────────────────────────────
function WhalePrints({
  orders,
  dateLocale,
}: {
  orders: DarkPoolOrder[];
  dateLocale: string;
}) {
  const top3 = [...orders]
    .filter((o) => o.value != null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 3);

  return (
    <div>
      <p className="mb-2 text-xs font-medium tracking-wider text-gray-500 uppercase">
        🐋 鲸鱼大单
      </p>
      <div className="space-y-2">
        {top3.map((o) => (
          <div
            key={o.id}
            className="flex items-center justify-between rounded-lg border border-purple-500/20 bg-purple-500/5 px-3 py-2"
          >
            <div>
              <span className="font-bold text-white">${o.symbol}</span>
              <span className="ml-2 text-xs text-gray-400">
                {o.exchange ?? "—"}
              </span>
            </div>
            <div className="text-right">
              <div
                className={`font-semibold tabular-nums ${valueColor(o.value)}`}
              >
                {formatValue(o.value)}
              </div>
              <div className="text-[10px] text-gray-500">
                {formatDate(o.trade_time, dateLocale)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Symbol Summary Strip ─────────────────────────────────────────────────────
interface SymbolGroup {
  symbol: string;
  totalValue: number;
  count: number;
  maxSingle: number;
}

function SymbolStrip({
  groups,
  active,
  onSelect,
}: {
  groups: SymbolGroup[];
  active: string;
  onSelect: (sym: string) => void;
}) {
  return (
    <div className="mb-6">
      <p className="mb-2 text-xs font-medium tracking-wider text-gray-500 uppercase">
        标的汇总
      </p>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {groups.map((g) => {
          const isActive = active === g.symbol;
          const whale = whaleBadge(g.maxSingle);
          return (
            <button
              key={g.symbol}
              onClick={() => onSelect(isActive ? "" : g.symbol)}
              className={`flex min-w-[130px] flex-col rounded-xl border p-3 text-left transition-all ${
                isActive
                  ? "border-purple-500/60 bg-purple-500/10"
                  : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.08]"
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="font-bold text-white">${g.symbol}</span>
                {whale && <span className="text-sm">{whale}</span>}
              </div>
              <div
                className={`text-sm font-semibold tabular-nums ${valueColor(g.totalValue)}`}
              >
                {formatValue(g.totalValue)}
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                {g.count} 笔 · 最大 {formatValue(g.maxSingle)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function DarkPoolPage() {
  const { t, dateLocale } = useI18n();
  const [symbolFilter, setSymbolFilter] = useState("");
  const [exchangeFilter, setExchangeFilter] = useState("");
  const [minValueM, setMinValueM] = useState("");

  const minValue =
    minValueM !== "" ? parseFloat(minValueM) * 1_000_000 : undefined;

  // Fetch all orders (unfiltered) for analytics, filtered for table
  const { orders: allOrders, loading } = useDarkPool({ limit: 300 });
  const { orders, total, error } = useDarkPool({
    symbol: symbolFilter || undefined,
    exchange: exchangeFilter || undefined,
    minValue,
    limit: 100,
  });

  // Symbol groups for summary strip (from all orders)
  const symbolGroups = Object.values(
    allOrders.reduce<Record<string, SymbolGroup>>((acc, o) => {
      if (!acc[o.symbol])
        acc[o.symbol] = {
          symbol: o.symbol,
          totalValue: 0,
          count: 0,
          maxSingle: 0,
        };
      acc[o.symbol].totalValue += o.value ?? 0;
      acc[o.symbol].count++;
      if ((o.value ?? 0) > acc[o.symbol].maxSingle)
        acc[o.symbol].maxSingle = o.value ?? 0;
      return acc;
    }, {}),
  ).sort((a, b) => b.totalValue - a.totalValue);

  return (
    <div>
      {/* Header */}
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Layers className="h-7 w-7 text-purple-400" />
              <div>
                <h1 className="text-3xl font-bold text-white">
                  {t("darkpool.title")}
                </h1>
                <p className="mt-1 text-gray-400">{t("darkpool.subtitle")}</p>
              </div>
            </div>
            <div className="rounded-lg bg-white/10 px-4 py-2 backdrop-blur">
              <span className="font-medium text-white">{total}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto space-y-6 px-6 py-8">
        {/* Info banner */}
        <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-3 text-sm text-purple-300">
          🌑
          暗池交易由机构在交易所外执行，方向性模糊但大额成交往往预示机构布局。
          数据来源：Unusual Whales / FINRA OTC Transparency
        </div>

        {/* Symbol Summary Strip */}
        {!loading && symbolGroups.length > 0 && (
          <SymbolStrip
            groups={symbolGroups}
            active={symbolFilter}
            onSelect={setSymbolFilter}
          />
        )}

        {/* Analytics Section */}
        {!loading && allOrders.length > 0 && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            {/* Timeline (left, 3 cols) */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 lg:col-span-3">
              <DarkPoolTimeline orders={symbolFilter ? orders : allOrders} />
            </div>

            {/* Right column (2 cols): exchange donut + whale prints */}
            <div className="flex flex-col gap-4 lg:col-span-2">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <ExchangeDonut orders={symbolFilter ? orders : allOrders} />
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <WhalePrints
                  orders={symbolFilter ? orders : allOrders}
                  dateLocale={dateLocale}
                />
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/10 bg-white/5 p-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t("filters.symbol")}
            </label>
            <input
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
              placeholder="NVDA"
              className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t("darkpool.filterExchange")}
            </label>
            <input
              value={exchangeFilter}
              onChange={(e) => setExchangeFilter(e.target.value.toUpperCase())}
              placeholder="DARK / FINRA_OTC"
              className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t("darkpool.minValue")} ($M)
            </label>
            <input
              value={minValueM}
              onChange={(e) => setMinValueM(e.target.value)}
              placeholder="1 = $1M"
              type="number"
              min="0"
              step="0.5"
              className="w-full rounded border border-white/10 bg-slate-900/70 px-3 py-2 text-white"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setSymbolFilter("");
                setExchangeFilter("");
                setMinValueM("");
              }}
              className="w-full rounded border border-white/10 bg-white/10 px-3 py-2 text-white hover:bg-white/20"
            >
              {t("filters.reset")}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-300">
            {error.message}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="h-5 w-20 rounded bg-white/10" />
                  <div className="h-5 w-24 rounded bg-white/10" />
                </div>
              </div>
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <div className="mb-4 text-5xl opacity-40">🌑</div>
            <p className="text-lg text-gray-400">{t("darkpool.empty")}</p>
            <p className="mt-2 text-sm text-gray-600">
              数据将在采集器下次运行后出现（每30分钟）
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5 text-left text-xs tracking-wide text-gray-400 uppercase">
                  <th className="px-4 py-3">{t("filters.symbol")}</th>
                  <th className="px-4 py-3">{t("darkpool.value")}</th>
                  <th className="px-4 py-3">{t("darkpool.size")}</th>
                  <th className="px-4 py-3">{t("darkpool.price")}</th>
                  <th className="px-4 py-3">{t("darkpool.exchange")}</th>
                  <th className="px-4 py-3">{t("darkpool.tradeTime")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const badge = whaleBadge(order.value);
                  return (
                    <tr
                      key={order.id}
                      className={`border-b border-white/5 transition-colors hover:bg-white/[0.04] ${
                        (order.value ?? 0) >= 10_000_000
                          ? "bg-purple-500/[0.03]"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-bold text-white">
                          ${order.symbol}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`font-semibold tabular-nums ${valueColor(order.value)}`}
                        >
                          {badge && (
                            <span className="mr-1 text-base">{badge}</span>
                          )}
                          {formatValue(order.value)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-300 tabular-nums">
                        {formatSize(order.size)}
                      </td>
                      <td className="px-4 py-3 text-gray-300 tabular-nums">
                        {order.price > 0 ? `$${order.price.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-xs text-purple-300">
                          {order.exchange || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {formatDate(order.trade_time, dateLocale)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
