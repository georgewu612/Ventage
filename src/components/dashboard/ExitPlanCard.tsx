"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  LogOut,
  Target,
  XCircle,
} from "lucide-react";
import { useState, useCallback } from "react";

import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StageLevel {
  level: number;
  trigger_label: string;
  trigger_price: number | null;
  trigger_r: number | null;
  reduce_pct: number;
  note: string;
}

interface ExitPlan {
  symbol: string;
  strategy_name: string;
  direction: string;
  entry_price: number;
  stop_price: number;
  risk_per_share: number;
  r1_price: number;
  time_stop_bars: number;
  stages: StageLevel[];
  invalidation_rules: string[];
  stop_note: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StageRow({
  stage,
  isZh,
  isFinal,
}: {
  stage: StageLevel;
  isZh: boolean;
  isFinal: boolean;
}) {
  const color =
    stage.level === 1
      ? "border-emerald-500/30 bg-emerald-500/5"
      : stage.level === 2
        ? "border-cyan-500/30 bg-cyan-500/5"
        : "border-violet-500/30 bg-violet-500/5";
  const textColor =
    stage.level === 1
      ? "text-emerald-300"
      : stage.level === 2
        ? "text-cyan-300"
        : "text-violet-300";

  return (
    <div className={`rounded-lg border p-2.5 ${color}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className={`text-[11px] font-semibold ${textColor}`}>
          {isZh ? `第 ${stage.level} 档` : `Stage ${stage.level}`}
          {isFinal && (
            <span className="ml-1 text-[9px] text-gray-500">
              ({isZh ? "清仓" : "full exit"})
            </span>
          )}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${textColor} bg-white/5`}
        >
          {isZh ? "减" : "-"}{stage.reduce_pct.toFixed(0)}%
        </span>
      </div>
      <p className={`mb-0.5 font-mono text-xs font-semibold ${textColor}`}>
        {stage.trigger_label}
      </p>
      <p className="text-[10px] text-gray-500">{stage.note}</p>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface ExitPlanCardProps {
  signalId?: string;
  /** Pass signal fields directly to generate plan client-side without DB lookup */
  signal?: {
    symbol: string;
    strategy_name: string;
    direction: string;
    entry_price: number;
    stop_price: number;
    target_1?: number | null;
    target_2?: number | null;
  };
}

export function ExitPlanCard({ signalId, signal }: ExitPlanCardProps) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<ExitPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (plan) return; // already loaded
    setLoading(true);
    setError(null);
    try {
      let url: string;
      let opts: RequestInit = {};

      if (signalId) {
        url = `${API_BASE_URL}/v1/risk/exit-plan/${signalId}`;
      } else if (signal) {
        // For signals without DB IDs (live scan results), call position-size
        // and build a minimal plan from signal data directly
        url = `${API_BASE_URL}/v1/risk/position-size`;
        opts = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: signal.symbol,
            grade: "A", // we only need plan structure, not position size
            strategy_name: signal.strategy_name,
            direction: signal.direction,
            entry_price: signal.entry_price,
            stop_price: signal.stop_price,
            target_1: signal.target_1,
            target_2: signal.target_2,
            account_size: 100000,
            risk_preference: "moderate",
          }),
        };
      } else {
        setError(isZh ? "缺少信号信息" : "Missing signal info");
        return;
      }

      if (signalId) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(await res.text());
        setPlan(await res.json());
      } else {
        // Build a synthetic plan from signal fields (no server call needed)
        const s = signal!;
        const risk = Math.abs(s.entry_price - s.stop_price) || s.entry_price * 0.02;
        const isLong = s.direction === "long";
        const r1 = isLong ? s.entry_price + risk : s.entry_price - risk;
        const t1 = s.target_1 ?? (isLong ? s.entry_price + 1.5 * risk : s.entry_price - 1.5 * risk);
        const t2 = s.target_2 ?? (isLong ? s.entry_price + 2.0 * risk : s.entry_price - 2.0 * risk);
        const t1r = Math.abs(t1 - s.entry_price) / risk;
        const t2r = Math.abs(t2 - s.entry_price) / risk;

        const syntheticPlan: ExitPlan = {
          symbol: s.symbol,
          strategy_name: s.strategy_name,
          direction: s.direction,
          entry_price: s.entry_price,
          stop_price: s.stop_price,
          risk_per_share: risk,
          r1_price: r1,
          time_stop_bars: 20,
          stages: [
            {
              level: 1,
              trigger_label: `${isZh ? "盈利 1R" : "1R profit"} ($${r1.toFixed(2)})`,
              trigger_price: r1,
              trigger_r: 1.0,
              reduce_pct: 40,
              note: isZh
                ? `止损上移至成本价 $${s.entry_price.toFixed(2)}`
                : `Move stop to breakeven $${s.entry_price.toFixed(2)}`,
            },
            {
              level: 2,
              trigger_label: `T1 $${t1.toFixed(2)} (${t1r.toFixed(1)}R)`,
              trigger_price: t1,
              trigger_r: t1r,
              reduce_pct: 40,
              note: isZh
                ? `止损移至 1R ($${r1.toFixed(2)})`
                : `Trail stop to 1R ($${r1.toFixed(2)})`,
            },
            {
              level: 3,
              trigger_label: `T2 $${t2.toFixed(2)} (${t2r.toFixed(1)}R)`,
              trigger_price: t2,
              trigger_r: t2r,
              reduce_pct: 100,
              note: isZh ? "清仓全部剩余" : "Exit remaining position",
            },
          ],
          invalidation_rules: [
            isZh
              ? `${isLong ? "跌破" : "突破"}止损价 $${s.stop_price.toFixed(2)} 立即出场`
              : `Exit immediately if ${isLong ? "below" : "above"} stop $${s.stop_price.toFixed(2)}`,
            isZh
              ? "连续 3 根 K 线反向穿越入场价"
              : "3 consecutive closes through entry price",
          ],
          stop_note: isZh
            ? `${isLong ? "跌破" : "突破"} $${s.stop_price.toFixed(2)} 全仓出场，亏损 1R ($${risk.toFixed(2)}/股)`
            : `Full exit ${isLong ? "below" : "above"} $${s.stop_price.toFixed(2)}, -1R ($${risk.toFixed(2)}/share)`,
        };
        setPlan(syntheticPlan);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [plan, signalId, signal, isZh]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !plan && !loading) load();
  };

  if (!signalId && !signal) return null;

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-white/10 bg-white/5">
      {/* Header */}
      <button
        onClick={handleToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2">
          <LogOut className="h-3.5 w-3.5 text-cyan-400" />
          <span className="text-xs font-semibold text-cyan-300">
            {isZh ? "出场计划" : "Exit Plan"}
          </span>
        </div>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-gray-500" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
        )}
      </button>

      {open && (
        <div className="border-t border-white/10 px-3 pb-3 pt-2.5 space-y-3">
          {loading && (
            <p className="text-center text-[11px] text-gray-500">
              {isZh ? "加载中…" : "Loading…"}
            </p>
          )}
          {error && (
            <p className="text-center text-[11px] text-red-400">{error}</p>
          )}
          {plan && (
            <>
              {/* Stop loss */}
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-2.5">
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                <div>
                  <p className="mb-0.5 text-[11px] font-semibold text-red-300">
                    {isZh ? "① 止损出场" : "① Stop Loss"}
                  </p>
                  <p className="text-[10px] text-gray-400">{plan.stop_note}</p>
                </div>
              </div>

              {/* Staged profit-taking */}
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-gray-300">
                  <Target className="h-3 w-3 text-emerald-400" />
                  {isZh ? "② 分批止盈" : "② Staged Profit Taking"}
                </p>
                <div className="space-y-1.5">
                  {plan.stages.map((s) => (
                    <StageRow
                      key={s.level}
                      stage={s}
                      isZh={isZh}
                      isFinal={s.level === plan.stages.length}
                    />
                  ))}
                </div>
              </div>

              {/* Logic invalidation */}
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-gray-300">
                  <AlertTriangle className="h-3 w-3 text-amber-400" />
                  {isZh ? "③ 逻辑失效出场" : "③ Logic Invalidation"}
                </p>
                <div className="space-y-1">
                  {plan.invalidation_rules.map((rule, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-1.5 rounded-md bg-amber-500/5 px-2 py-1.5"
                    >
                      <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      <p className="text-[10px] text-gray-400">{rule}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Time stop */}
              <div className="flex items-start gap-2 rounded-lg border border-slate-500/20 bg-slate-500/5 p-2.5">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <div>
                  <p className="mb-0.5 text-[11px] font-semibold text-slate-300">
                    {isZh ? "④ 时间止损" : "④ Time Stop"}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {isZh
                      ? `持仓超过 ${plan.time_stop_bars} 根 K 线（约 1 个月）且未达 1R，清仓离场`
                      : `Exit if ${plan.time_stop_bars}+ bars pass without reaching 1R (~1 month)`}
                  </p>
                </div>
              </div>

              {/* R summary */}
              <div className="rounded-lg bg-white/5 p-2.5">
                <p className="mb-1.5 text-[10px] font-semibold text-gray-400">
                  {isZh ? "盈亏比总结" : "R Summary"}
                </p>
                <div className="flex gap-3 text-center">
                  {plan.stages.map((s) => (
                    <div key={s.level} className="flex-1">
                      <p className="font-mono text-xs font-bold text-white">
                        {s.trigger_r != null ? `${s.trigger_r.toFixed(1)}R` : "—"}
                      </p>
                      <p className="text-[9px] text-gray-500">
                        T{s.level} ({isZh ? "减" : "-"}{s.reduce_pct.toFixed(0)}%)
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-center text-[9px] text-gray-600">
                {isZh
                  ? "* 出场规则仅供参考，请结合实际盘面灵活执行"
                  : "* Exit rules are guidelines — adapt to live market conditions"}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
