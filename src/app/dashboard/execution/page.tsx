"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  XCircle,
  X,
  AlertTriangle,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { API_BASE_URL } from "@/lib/config";
import { FeatureGate } from "@/components/ui/FeatureGate";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Order {
  order_id: string;
  symbol: string;
  side: "buy" | "sell";
  order_type: "market" | "limit" | "stop";
  quantity: number;
  limit_price?: number;
  stop_price?: number;
  status: "pending" | "filled" | "cancelled" | "rejected";
  fill_price?: number;
  filled_at?: string;
  created_at: string;
  notes?: string;
}

interface Position {
  symbol: string;
  quantity: number;
  cost_basis: number;
  trades: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CFG = {
  pending: { label: "等待中", cls: "bg-blue-500/20 text-blue-400" },
  filled: { label: "已成交", cls: "bg-emerald-500/20 text-emerald-400" },
  cancelled: { label: "已撤单", cls: "bg-gray-500/20 text-gray-500" },
  rejected: { label: "已拒绝", cls: "bg-red-500/20 text-red-400" },
};

function StatusBadge({ status }: { status: Order["status"] }) {
  const cfg = STATUS_CFG[status];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ExecutionPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // New order modal
  const [showOrder, setShowOrder] = useState(false);
  const [sym, setSym] = useState("NVDA");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit" | "stop">(
    "market",
  );
  const [qty, setQty] = useState("10");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastFill, setLastFill] = useState<{
    symbol: string;
    price: number;
    side: string;
  } | null>(null);

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
      const [ordRes, posRes] = await Promise.allSettled([
        fetch(`${API_BASE_URL}/v1/execution/orders?user_id=${userId}&limit=50`),
        fetch(`${API_BASE_URL}/v1/execution/positions?user_id=${userId}`),
      ]);
      if (ordRes.status === "fulfilled" && ordRes.value.ok)
        setOrders(await ordRes.value.json());
      if (posRes.status === "fulfilled" && posRes.value.ok) {
        const d = await posRes.value.json();
        setPositions(d.positions ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const refresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  const submitOrder = async () => {
    if (!userId || !sym || !qty) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, unknown> = {
        user_id: userId,
        symbol: sym.toUpperCase(),
        side,
        order_type: orderType,
        quantity: parseFloat(qty),
        notes: notes || null,
      };
      if (orderType === "limit" && limitPrice)
        body.limit_price = parseFloat(limitPrice);
      if (orderType === "stop" && stopPrice)
        body.stop_price = parseFloat(stopPrice);

      const r = await fetch(`${API_BASE_URL}/v1/execution/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "下单失败");

      if (data.fill_price) {
        setLastFill({
          symbol: sym.toUpperCase(),
          price: data.fill_price,
          side,
        });
      }
      setShowOrder(false);
      setSym("NVDA");
      setQty("10");
      setLimitPrice("");
      setStopPrice("");
      setNotes("");
      await loadAll();
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "未知错误");
    }
    setSubmitting(false);
  };

  const cancelOrder = async (orderId: string) => {
    if (!userId) return;
    await fetch(
      `${API_BASE_URL}/v1/execution/order/${orderId}?user_id=${userId}`,
      { method: "DELETE" },
    );
    await loadAll();
  };

  return (
    <FeatureGate feature="execution" overlay>
      <div className="min-h-screen bg-slate-900 p-6">
        <div className="mx-auto max-w-6xl">
          {/* Header */}
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-xl bg-emerald-500/15 p-2.5">
              <Activity className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">执行层</h1>
              <p className="text-sm text-gray-400">
                模拟交易 (Paper Trading) · IBKR 接入预留
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1">
                <AlertTriangle className="h-3 w-3 text-amber-400" />
                <span className="text-xs font-medium text-amber-400">
                  模拟交易模式
                </span>
              </div>
              <button
                onClick={() => setShowOrder(true)}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-400"
              >
                <Plus className="h-3.5 w-3.5" /> 下单
              </button>
              <button
                onClick={refresh}
                disabled={refreshing}
                className="rounded-lg border border-white/10 p-2 text-gray-400 hover:bg-white/5"
              >
                <RefreshCw
                  className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          </div>

          {/* Fill notification */}
          {lastFill && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              <p className="text-sm text-emerald-300">
                <span className="font-bold">{lastFill.symbol}</span> 模拟
                {lastFill.side === "buy" ? "买入" : "卖出"}成交 — 成交价{" "}
                <span className="font-bold">${lastFill.price.toFixed(2)}</span>
              </p>
              <button
                onClick={() => setLastFill(null)}
                className="ml-auto text-emerald-600 hover:text-emerald-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Paper Positions */}
            <div className="lg:col-span-1">
              <h2 className="mb-3 text-xs font-semibold tracking-wider text-gray-500 uppercase">
                模拟持仓
              </h2>
              {positions.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 py-10 text-center">
                  <p className="text-sm text-gray-600">暂无持仓</p>
                  <p className="mt-1 text-xs text-gray-700">下单后自动更新</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {positions.map((p) => (
                    <div
                      key={p.symbol}
                      className="rounded-xl border border-white/10 bg-white/5 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-sm font-bold text-cyan-400">
                          {p.symbol}
                        </span>
                        <span className="text-xs text-gray-500">
                          {p.trades} 笔成交
                        </span>
                      </div>
                      <div className="mt-2 flex justify-between text-xs text-gray-400">
                        <span>
                          持仓量{" "}
                          <span className="font-medium text-white">
                            {p.quantity}
                          </span>
                        </span>
                        <span>
                          成本{" "}
                          <span className="font-medium text-white">
                            ${p.cost_basis.toFixed(2)}
                          </span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Order History */}
            <div className="lg:col-span-2">
              <h2 className="mb-3 text-xs font-semibold tracking-wider text-gray-500 uppercase">
                订单历史
              </h2>
              {loading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
                </div>
              ) : orders.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 py-16 text-center">
                  <Activity className="mx-auto mb-3 h-8 w-8 text-gray-700" />
                  <p className="text-sm text-gray-500">还没有订单</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-white/10">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        {[
                          "股票",
                          "方向",
                          "类型",
                          "数量",
                          "成交价",
                          "状态",
                          "时间",
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
                      {orders.map((o) => (
                        <tr key={o.order_id} className="hover:bg-white/[0.03]">
                          <td className="px-3 py-2.5 font-mono text-sm font-bold text-cyan-400">
                            {o.symbol}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`flex items-center gap-1 text-xs font-semibold ${o.side === "buy" ? "text-emerald-400" : "text-red-400"}`}
                            >
                              {o.side === "buy" ? (
                                <ArrowUpRight className="h-3 w-3" />
                              ) : (
                                <ArrowDownRight className="h-3 w-3" />
                              )}
                              {o.side === "buy" ? "买入" : "卖出"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-400">
                            {o.order_type === "market"
                              ? "市价"
                              : o.order_type === "limit"
                                ? "限价"
                                : "止损"}
                          </td>
                          <td className="px-3 py-2.5 text-sm text-gray-300">
                            {o.quantity}
                          </td>
                          <td className="px-3 py-2.5 text-sm text-white">
                            {o.fill_price
                              ? `$${o.fill_price.toFixed(2)}`
                              : o.limit_price
                                ? `$${o.limit_price.toFixed(2)}`
                                : "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge status={o.status} />
                          </td>
                          <td className="px-3 py-2.5 text-xs text-gray-600">
                            {new Date(o.created_at).toLocaleString("zh-CN", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="px-3 py-2.5">
                            {o.status === "pending" && (
                              <button
                                onClick={() => cancelOrder(o.order_id)}
                                className="rounded p-1 text-gray-600 hover:text-red-400"
                                title="撤单"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* IBKR Coming Soon */}
          <div className="mt-6 rounded-2xl border border-dashed border-white/10 p-5 text-center">
            <p className="text-sm font-semibold text-gray-500">IBKR 实盘接入</p>
            <p className="mt-1 text-xs text-gray-600">
              安装 IB Gateway → 配置 TWS API → 切换执行模式为 ibkr。即将开放。
            </p>
          </div>
        </div>
      </div>

      {/* New Order Modal */}
      {showOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-5">
              <h2 className="font-bold text-white">模拟下单</h2>
              <button
                onClick={() => setShowOrder(false)}
                className="text-gray-500 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              {/* Side toggle */}
              <div className="grid grid-cols-2 gap-2">
                {(["buy", "sell"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSide(s)}
                    className={`rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                      side === s
                        ? s === "buy"
                          ? "bg-emerald-500 text-white"
                          : "bg-red-500 text-white"
                        : "border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
                    }`}
                  >
                    {s === "buy" ? "买入" : "卖出"}
                  </button>
                ))}
              </div>

              {/* Symbol + Qty */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-400">
                    股票代码
                  </label>
                  <input
                    value={sym}
                    onChange={(e) => setSym(e.target.value.toUpperCase())}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
                    placeholder="NVDA"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-400">
                    数量（股）
                  </label>
                  <input
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
                    placeholder="10"
                    type="number"
                  />
                </div>
              </div>

              {/* Order Type */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-400">
                  订单类型
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(["market", "limit", "stop"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setOrderType(t)}
                      className={`rounded-lg py-2 text-xs font-medium transition-colors ${
                        orderType === t
                          ? "border border-cyan-500/30 bg-cyan-500/20 text-cyan-300"
                          : "border border-white/10 text-gray-400 hover:bg-white/5"
                      }`}
                    >
                      {t === "market"
                        ? "市价"
                        : t === "limit"
                          ? "限价"
                          : "止损"}
                    </button>
                  ))}
                </div>
              </div>

              {orderType === "limit" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-400">
                    限价 ($)
                  </label>
                  <input
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                    type="number"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
                    placeholder="450.00"
                  />
                </div>
              )}
              {orderType === "stop" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-400">
                    止损价 ($)
                  </label>
                  <input
                    value={stopPrice}
                    onChange={(e) => setStopPrice(e.target.value)}
                    type="number"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
                    placeholder="430.00"
                  />
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-400">
                  备注（可选）
                </label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none"
                  placeholder="来自信号 #xxx"
                />
              </div>

              {submitError && (
                <p className="text-xs text-red-400">{submitError}</p>
              )}

              <div className="rounded-lg bg-amber-500/10 p-2.5">
                <p className="text-center text-[10px] text-amber-500">
                  ⚠️ 模拟交易 — 不涉及真实资金
                </p>
              </div>
            </div>
            <div className="border-t border-white/10 p-5">
              <button
                onClick={submitOrder}
                disabled={submitting}
                className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50 ${
                  side === "buy"
                    ? "bg-emerald-500 hover:bg-emerald-400"
                    : "bg-red-500 hover:bg-red-400"
                }`}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {submitting
                  ? "提交中…"
                  : `确认${side === "buy" ? "买入" : "卖出"} ${sym}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeatureGate>
  );
}
