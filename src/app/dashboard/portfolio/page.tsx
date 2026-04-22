"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { API_BASE_URL } from "@/lib/config";
import { FeatureGate } from "@/components/ui/FeatureGate";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Holding {
  symbol: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  pnl: number;
  pnl_pct: number;
  weight: number;
  notes?: string;
}

interface Summary {
  holdings: Holding[];
  total_value: number;
  total_cost: number;
  total_pnl: number;
  total_pnl_pct: number;
  position_count: number;
}

interface Exposure {
  sectors: Record<string, number>;
  top5_concentration: number;
  largest_position: Holding | null;
}

interface Snapshot {
  snapshot_date: string;
  total_value: number;
  total_pnl: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number, prefix = "$") {
  if (Math.abs(v) >= 1_000_000)
    return `${prefix}${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `${prefix}${(v / 1_000).toFixed(1)}K`;
  return `${prefix}${v.toFixed(2)}`;
}

function PnlBadge({ value, pct }: { value: number; pct: number }) {
  const up = value >= 0;
  return (
    <span
      className={`flex items-center gap-1 text-xs font-semibold ${up ? "text-emerald-400" : "text-red-400"}`}
    >
      {up ? (
        <ArrowUpRight className="h-3 w-3" />
      ) : (
        <ArrowDownRight className="h-3 w-3" />
      )}
      {fmt(Math.abs(value))} ({Math.abs(pct).toFixed(1)}%)
    </span>
  );
}

// ── Equity sparkline ──────────────────────────────────────────────────────────

function EquitySparkline({ data }: { data: Snapshot[] }) {
  if (data.length < 2) return null;
  const vals = data.map((d) => d.total_value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const W = 600;
  const H = 80;
  const pad = 6;
  const pts = data
    .map((d, i) => {
      const x = pad + (i / (data.length - 1)) * (W - 2 * pad);
      const y = pad + ((max - d.total_value) / range) * (H - 2 * pad);
      return `${x},${y}`;
    })
    .join(" ");
  const isUp = vals[vals.length - 1] >= vals[0];
  return (
    <div className="w-full overflow-hidden rounded-xl bg-black/20">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        preserveAspectRatio="none"
      >
        <polyline
          points={pts}
          fill="none"
          stroke={isUp ? "#34d399" : "#f87171"}
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [exposure, setExposure] = useState<Exposure | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Add position modal
  const [showAdd, setShowAdd] = useState(false);
  const [addSymbol, setAddSymbol] = useState("");
  const [addQty, setAddQty] = useState("");
  const [addCost, setAddCost] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // CSV import modal
  const [showCsv, setShowCsv] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    createSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (user) setUserId(user.id);
      });
  }, []);

  useEffect(() => {
    if (userId) loadAll();
  }, [userId]);

  const loadAll = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [sumRes, expRes, histRes] = await Promise.allSettled([
        fetch(`${API_BASE_URL}/v1/portfolio/summary?user_id=${userId}`),
        fetch(`${API_BASE_URL}/v1/portfolio/exposure?user_id=${userId}`),
        fetch(`${API_BASE_URL}/v1/portfolio/history?user_id=${userId}&days=90`),
      ]);
      if (sumRes.status === "fulfilled" && sumRes.value.ok)
        setSummary(await sumRes.value.json());
      if (expRes.status === "fulfilled" && expRes.value.ok)
        setExposure(await expRes.value.json());
      if (histRes.status === "fulfilled" && histRes.value.ok) {
        const d = await histRes.value.json();
        setHistory(d.snapshots ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const refresh = async () => {
    setRefreshing(true);
    await loadAll();
    // Save today's snapshot
    if (userId)
      await fetch(`${API_BASE_URL}/v1/portfolio/snapshot?user_id=${userId}`, {
        method: "POST",
      });
    setRefreshing(false);
  };

  const addHolding = async () => {
    if (!userId || !addSymbol || !addQty || !addCost) return;
    setAddLoading(true);
    setAddError(null);
    try {
      const r = await fetch(`${API_BASE_URL}/v1/portfolio/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          holdings: [
            {
              symbol: addSymbol.toUpperCase(),
              quantity: parseFloat(addQty),
              avg_cost: parseFloat(addCost),
            },
          ],
        }),
      });
      if (!r.ok) throw new Error((await r.json()).detail);
      setShowAdd(false);
      setAddSymbol("");
      setAddQty("");
      setAddCost("");
      await loadAll();
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : "错误");
    }
    setAddLoading(false);
  };

  const deleteHolding = async (symbol: string) => {
    if (!userId) return;
    await fetch(
      `${API_BASE_URL}/v1/portfolio/holding/${symbol}?user_id=${userId}`,
      { method: "DELETE" },
    );
    await loadAll();
  };

  const importCsv = async () => {
    if (!userId || !csvText.trim()) return;
    setCsvLoading(true);
    setCsvError(null);
    try {
      const r = await fetch(`${API_BASE_URL}/v1/portfolio/upload-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, csv_text: csvText }),
      });
      if (!r.ok) throw new Error((await r.json()).detail);
      setShowCsv(false);
      setCsvText("");
      await loadAll();
    } catch (e: unknown) {
      setCsvError(e instanceof Error ? e.message : "解析失败");
    }
    setCsvLoading(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText((ev.target?.result as string) ?? "");
    reader.readAsText(file);
  };

  const isEmpty = !summary || summary.holdings.length === 0;

  return (
    <FeatureGate feature="portfolio" overlay>
      <div className="min-h-screen bg-slate-900 p-6">
        <div className="mx-auto max-w-6xl">
          {/* Header */}
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-xl bg-cyan-500/15 p-2.5">
              <Wallet className="h-6 w-6 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">组合监控</h1>
              <p className="text-sm text-gray-400">
                持仓管理 · 收益追踪 · 风险敞口
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setShowCsv(true)}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-300 hover:bg-white/5"
              >
                <Upload className="h-3.5 w-3.5" /> 导入 CSV
              </button>
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-400"
              >
                <Plus className="h-3.5 w-3.5" /> 添加持仓
              </button>
              <button
                onClick={refresh}
                disabled={refreshing}
                className="rounded-lg border border-white/10 p-2 text-gray-400 hover:bg-white/5 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          </div>

          {loading && (
            <div className="flex justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
            </div>
          )}

          {!loading && isEmpty && (
            <div className="rounded-2xl border border-white/10 bg-white/5 py-20 text-center">
              <Wallet className="mx-auto mb-4 h-10 w-10 text-gray-700" />
              <p className="text-gray-400">还没有持仓</p>
              <p className="mt-1 text-sm text-gray-600">
                点击「添加持仓」手动录入，或「导入 CSV」批量导入
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <button
                  onClick={() => setShowAdd(true)}
                  className="flex items-center gap-2 rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-400"
                >
                  <Plus className="h-4 w-4" /> 添加持仓
                </button>
                <button
                  onClick={() => setShowCsv(true)}
                  className="flex items-center gap-2 rounded-xl border border-white/10 px-5 py-2.5 text-sm text-gray-300 hover:bg-white/5"
                >
                  <Upload className="h-4 w-4" /> 导入 CSV
                </button>
              </div>
            </div>
          )}

          {!loading && summary && summary.holdings.length > 0 && (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  {
                    label: "总市值",
                    value: fmt(summary.total_value),
                    sub: null,
                  },
                  {
                    label: "总成本",
                    value: fmt(summary.total_cost),
                    sub: null,
                  },
                  {
                    label: "总盈亏",
                    value: fmt(summary.total_pnl),
                    sub: `${summary.total_pnl_pct.toFixed(1)}%`,
                    positive: summary.total_pnl >= 0,
                  },
                  {
                    label: "持仓数量",
                    value: String(summary.position_count),
                    sub: "只股票",
                  },
                ].map(({ label, value, sub, positive }) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <p className="mb-1 text-xs text-gray-500">{label}</p>
                    <p
                      className={`text-xl font-bold ${positive === undefined ? "text-white" : positive ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {value}
                    </p>
                    {sub && (
                      <p
                        className={`mt-0.5 text-xs ${positive === undefined ? "text-gray-500" : positive ? "text-emerald-600" : "text-red-600"}`}
                      >
                        {sub}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Equity Curve */}
              {history.length > 1 && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <p className="mb-3 text-sm font-semibold text-gray-300">
                    组合净值曲线（近 90 天）
                  </p>
                  <EquitySparkline data={history} />
                  <div className="mt-2 flex justify-between text-xs text-gray-600">
                    <span>{history[0]?.snapshot_date}</span>
                    <span>{history[history.length - 1]?.snapshot_date}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {/* Holdings Table */}
                <div className="lg:col-span-2">
                  <div className="overflow-hidden rounded-2xl border border-white/10">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/5">
                          {[
                            "股票",
                            "持仓量",
                            "成本",
                            "现价",
                            "市值",
                            "盈亏",
                            "权重",
                            "",
                          ].map((h) => (
                            <th
                              key={h}
                              className="px-3 py-3 text-left text-[10px] font-semibold text-gray-500 uppercase"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {summary.holdings.map((h) => (
                          <tr key={h.symbol} className="hover:bg-white/[0.03]">
                            <td className="px-3 py-3 font-mono text-sm font-bold text-cyan-400">
                              {h.symbol}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-300">
                              {h.quantity}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-400">
                              ${h.avg_cost.toFixed(2)}
                            </td>
                            <td className="px-3 py-3 text-sm text-white">
                              ${h.current_price.toFixed(2)}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-300">
                              {fmt(h.market_value)}
                            </td>
                            <td className="px-3 py-3">
                              <PnlBadge value={h.pnl} pct={h.pnl_pct} />
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
                                  <div
                                    className="h-full bg-cyan-500"
                                    style={{
                                      width: `${Math.min(h.weight, 100)}%`,
                                    }}
                                  />
                                </div>
                                <span className="text-xs text-gray-500">
                                  {h.weight.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <button
                                onClick={() => deleteHolding(h.symbol)}
                                className="text-gray-600 hover:text-red-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Exposure Panel */}
                <div className="space-y-4">
                  {exposure && (
                    <>
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="mb-3 text-xs font-semibold tracking-wider text-gray-500 uppercase">
                          行业分布
                        </p>
                        {Object.entries(exposure.sectors)
                          .sort(([, a], [, b]) => b - a)
                          .map(([sec, wt]) => (
                            <div key={sec} className="mb-2">
                              <div className="mb-1 flex justify-between text-xs">
                                <span className="truncate text-gray-400">
                                  {sec}
                                </span>
                                <span className="font-medium text-gray-300">
                                  {wt.toFixed(1)}%
                                </span>
                              </div>
                              <div className="h-1 overflow-hidden rounded-full bg-white/10">
                                <div
                                  className="h-full bg-purple-500"
                                  style={{ width: `${Math.min(wt, 100)}%` }}
                                />
                              </div>
                            </div>
                          ))}
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="mb-3 text-xs font-semibold tracking-wider text-gray-500 uppercase">
                          集中度风险
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-400">
                            前 5 大持仓
                          </span>
                          <span
                            className={`text-lg font-bold ${exposure.top5_concentration > 80 ? "text-red-400" : exposure.top5_concentration > 60 ? "text-amber-400" : "text-emerald-400"}`}
                          >
                            {exposure.top5_concentration.toFixed(1)}%
                          </span>
                        </div>
                        {exposure.top5_concentration > 70 && (
                          <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 p-2.5">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                            <p className="text-xs text-amber-400">
                              前 5 大持仓集中度较高，注意分散风险
                            </p>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Holding Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-5">
              <h2 className="font-bold text-white">添加持仓</h2>
              <button
                onClick={() => setShowAdd(false)}
                className="text-gray-500 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              {[
                {
                  label: "股票代码",
                  value: addSymbol,
                  set: setAddSymbol,
                  placeholder: "NVDA",
                  upper: true,
                },
                {
                  label: "持仓数量（股）",
                  value: addQty,
                  set: setAddQty,
                  placeholder: "100",
                },
                {
                  label: "平均成本（$/股）",
                  value: addCost,
                  set: setAddCost,
                  placeholder: "450.00",
                },
              ].map(({ label, value, set, placeholder, upper }) => (
                <div key={label}>
                  <label className="mb-1.5 block text-xs font-medium text-gray-400">
                    {label}
                  </label>
                  <input
                    value={value}
                    onChange={(e) =>
                      set(upper ? e.target.value.toUpperCase() : e.target.value)
                    }
                    placeholder={placeholder}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none"
                  />
                </div>
              ))}
              {addError && <p className="text-xs text-red-400">{addError}</p>}
            </div>
            <div className="border-t border-white/10 p-5">
              <button
                onClick={addHolding}
                disabled={addLoading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-3 text-sm font-semibold text-white hover:bg-cyan-400 disabled:opacity-50"
              >
                {addLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {addLoading ? "保存中…" : "确认添加"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showCsv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-5">
              <div>
                <h2 className="font-bold text-white">导入 CSV</h2>
                <p className="text-xs text-gray-500">
                  支持 TD Ameritrade / IBKR 导出格式
                </p>
              </div>
              <button
                onClick={() => setShowCsv(false)}
                className="text-gray-500 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <p className="mb-2 text-xs text-gray-500">
                  CSV 需包含列：
                  <code className="text-cyan-400">
                    symbol, quantity, avg_cost
                  </code>
                </p>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 py-3 text-sm text-gray-400 hover:border-white/40 hover:text-white"
                >
                  <Upload className="h-4 w-4" /> 点击上传文件
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-400">
                  或直接粘贴 CSV 内容
                </label>
                <textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  rows={6}
                  placeholder={
                    "symbol,quantity,avg_cost\nNVDA,100,450.00\nAAPL,50,175.00"
                  }
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-gray-300 placeholder-gray-700 focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
              {csvError && <p className="text-xs text-red-400">{csvError}</p>}
            </div>
            <div className="border-t border-white/10 p-5">
              <button
                onClick={importCsv}
                disabled={csvLoading || !csvText.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-3 text-sm font-semibold text-white hover:bg-cyan-400 disabled:opacity-50"
              >
                {csvLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {csvLoading ? "导入中…" : "开始导入"}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeatureGate>
  );
}
