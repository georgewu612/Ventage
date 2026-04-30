"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BarChart2,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import Link from "next/link";

import { API_BASE_URL } from "@/lib/config";
import { FeatureGate } from "@/components/ui/FeatureGate";
import { useI18n } from "@/lib/i18n/provider";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RunInfo {
  id: string;
  template_name: string;
  symbol: string;
  start_date: string;
  end_date: string;
  status: "pending" | "running" | "done" | "failed";
  params: Record<string, number>;
  created_at: string;
  finished_at: string | null;
  error_msg?: string | null;
}

interface Results {
  total_return: number;
  annualized_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
  total_trades: number;
  profit_factor: number;
  equity_curve: { date: string; value: number }[];
}

interface Trade {
  id: string;
  entry_date: string;
  exit_date: string;
  side: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  pnl: number;
  pnl_pct: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pct(v: number) {
  return `${(v * 100).toFixed(2)}%`;
}

function sign(v: number) {
  return v >= 0 ? "+" : "";
}

// ── Subcomponents ──────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  positive,
  sub,
}: {
  label: string;
  value: string;
  positive?: boolean;
  sub?: string;
}) {
  const color =
    positive === undefined
      ? "text-white"
      : positive
        ? "text-emerald-400"
        : "text-red-400";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="mb-1 text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
        {label}
      </p>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-600">{sub}</p>}
    </div>
  );
}

function EquityChart({ data }: { data: { date: string; value: number }[] }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length < 2)
    return (
      <div className="flex h-48 items-center justify-center text-sm text-gray-600">
        {t("quant.detail.noEquityCurve")}
      </div>
    );

  const values = data.map((d) => d.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const W = 800;
  const H = 220;
  const pad = { x: 12, y: 18 };

  const xy = (i: number, v: number): [number, number] => {
    const x = pad.x + (i / (data.length - 1)) * (W - 2 * pad.x);
    const y = pad.y + ((maxV - v) / range) * (H - 2 * pad.y);
    return [x, y];
  };

  const points = data.map((d, i) => xy(i, d.value));

  // Smooth curve via Catmull-Rom → bezier
  const smoothPath = (() => {
    if (points.length < 2) return "";
    const tension = 0.5;
    const path: string[] = [`M${points[0][0]},${points[0][1]}`];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const cp1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension;
      const cp1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension;
      const cp2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension;
      const cp2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension;
      path.push(`C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`);
    }
    return path.join(" ");
  })();

  const baselineY = H - pad.y;
  const lastX = points[points.length - 1][0];
  const lastY = points[points.length - 1][1];
  const firstX = points[0][0];

  const isUp = values[values.length - 1] >= values[0];

  // Baseline at value=1 (used to split colors)
  const baselineAtOne =
    1 >= minV && 1 <= maxV
      ? pad.y + ((maxV - 1) / range) * (H - 2 * pad.y)
      : null;

  // Area path: split into "above 1.0" (green) and "below 1.0" (red)
  // We render the same line/area twice with clipPath rectangles
  const areaPathToBaseline = `${smoothPath} L${lastX},${baselineAtOne ?? baselineY} L${firstX},${baselineAtOne ?? baselineY} Z`;
  const areaPathBelowFromBaseline = `M${firstX},${baselineAtOne ?? baselineY} ${smoothPath.replace(/^M/, "L")} L${lastX},${baselineAtOne ?? baselineY} Z`;

  // 4 horizontal grid lines (25%/50%/75%)
  const grid = [0.25, 0.5, 0.75].map((frac) => pad.y + frac * (H - 2 * pad.y));

  const uid = useId().replace(/[:]/g, "");
  const fillUpId = `eq-fillUp-${uid}`;
  const fillDownId = `eq-fillDown-${uid}`;
  const glowFilterId = `eq-glow-${uid}`;
  const bgGradId = `eq-bg-${uid}`;
  const clipUpId = `eq-clipUp-${uid}`;
  const clipDownId = `eq-clipDown-${uid}`;

  // Hover handler — find nearest data index by mouse X
  const handleMouseMove = (e: React.MouseEvent<SVGElement>) => {
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    // Convert client X → SVG-coordinate X
    const xClient = e.clientX - rect.left;
    const xSvg = (xClient / rect.width) * W;
    // Find closest point
    let bestI = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i][0] - xSvg);
      if (d < bestDist) {
        bestDist = d;
        bestI = i;
      }
    }
    setHoverIdx(bestI);
  };

  // Compute tooltip position (clamped to chart bounds)
  let tooltipStyle: React.CSSProperties = { display: "none" };
  let hoverX = 0;
  let hoverY = 0;
  let hoverV = 0;
  let hoverDate = "";
  let hoverPct = 0;
  if (hoverIdx !== null && containerRef.current) {
    const cw = containerRef.current.clientWidth;
    hoverX = points[hoverIdx][0];
    hoverY = points[hoverIdx][1];
    hoverV = data[hoverIdx].value;
    hoverDate = data[hoverIdx].date;
    hoverPct = (hoverV - 1) * 100;
    const xPct = (hoverX / W) * 100;
    const tooltipWidth = 140;
    const leftPx = (xPct / 100) * cw;
    const clampedLeft = Math.min(
      Math.max(leftPx, tooltipWidth / 2 + 8),
      cw - tooltipWidth / 2 - 8,
    );
    tooltipStyle = {
      left: `${clampedLeft}px`,
      transform: "translateX(-50%)",
    };
  }

  const hoverIsLoss = hoverIdx !== null && hoverV < 1;

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden rounded-2xl border ${
        isUp
          ? "border-emerald-500/15 bg-gradient-to-br from-emerald-950/30 via-slate-900/40 to-slate-900/60"
          : "border-red-500/15 bg-gradient-to-br from-red-950/30 via-slate-900/40 to-slate-900/60"
      } p-3 shadow-inner`}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          {/* Backdrop wash */}
          <radialGradient id={bgGradId} cx="50%" cy="0%" r="80%">
            <stop
              offset="0%"
              stopColor={
                isUp ? "rgba(16,185,129,0.55)" : "rgba(239,68,68,0.55)"
              }
              stopOpacity="0.08"
            />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
          {/* Above-baseline fill (green) */}
          <linearGradient id={fillUpId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.04" />
          </linearGradient>
          {/* Below-baseline fill (red) */}
          <linearGradient id={fillDownId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#f87171" stopOpacity="0.45" />
          </linearGradient>
          {/* Glow */}
          <filter
            id={glowFilterId}
            x="-20%"
            y="-50%"
            width="140%"
            height="200%"
          >
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Clip rectangles to split line into above/below baseline halves */}
          <clipPath id={clipUpId}>
            <rect x="0" y="0" width={W} height={baselineAtOne ?? H} />
          </clipPath>
          <clipPath id={clipDownId}>
            <rect
              x="0"
              y={baselineAtOne ?? H}
              width={W}
              height={H - (baselineAtOne ?? H)}
            />
          </clipPath>
        </defs>

        <rect x="0" y="0" width={W} height={H} fill={`url(#${bgGradId})`} />

        {/* Grid */}
        {grid.map((y, i) => (
          <line
            key={i}
            x1={pad.x}
            y1={y}
            x2={W - pad.x}
            y2={y}
            stroke="currentColor"
            strokeOpacity="0.06"
            strokeWidth="1"
          />
        ))}

        {/* Baseline at 1.0 */}
        {baselineAtOne !== null && (
          <>
            <line
              x1={pad.x}
              y1={baselineAtOne}
              x2={W - pad.x}
              y2={baselineAtOne}
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="1"
              strokeDasharray="5 4"
            />
            <text
              x={W - pad.x - 4}
              y={baselineAtOne - 4}
              fill="currentColor"
              fillOpacity="0.45"
              fontSize="10"
              textAnchor="end"
            >
              1.0
            </text>
          </>
        )}

        {/* Filled areas — split at baseline */}
        <g clipPath={`url(#${clipUpId})`}>
          <path d={areaPathToBaseline} fill={`url(#${fillUpId})`} />
        </g>
        <g clipPath={`url(#${clipDownId})`}>
          <path d={areaPathBelowFromBaseline} fill={`url(#${fillDownId})`} />
        </g>

        {/* Glow shadow under line — green above, red below baseline */}
        <g clipPath={`url(#${clipUpId})`}>
          <path
            d={smoothPath}
            fill="none"
            stroke="rgba(16,185,129,0.55)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${glowFilterId})`}
            opacity="0.55"
          />
        </g>
        <g clipPath={`url(#${clipDownId})`}>
          <path
            d={smoothPath}
            fill="none"
            stroke="rgba(239,68,68,0.55)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${glowFilterId})`}
            opacity="0.55"
          />
        </g>

        {/* Main line — green above baseline */}
        <g clipPath={`url(#${clipUpId})`}>
          <path
            d={smoothPath}
            fill="none"
            stroke="#10b981"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        {/* Main line — red below baseline */}
        <g clipPath={`url(#${clipDownId})`}>
          <path
            d={smoothPath}
            fill="none"
            stroke="#ef4444"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* Hover crosshair */}
        {hoverIdx !== null && (
          <>
            <line
              x1={hoverX}
              y1={pad.y}
              x2={hoverX}
              y2={H - pad.y}
              stroke="currentColor"
              strokeOpacity="0.35"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle
              cx={hoverX}
              cy={hoverY}
              r="6"
              fill={hoverIsLoss ? "#fca5a5" : "#6ee7b7"}
              fillOpacity="0.25"
            />
            <circle
              cx={hoverX}
              cy={hoverY}
              r="3.5"
              fill={hoverIsLoss ? "#ef4444" : "#10b981"}
              stroke="white"
              strokeOpacity="0.9"
              strokeWidth="1.2"
            />
          </>
        )}

        {/* End point pulse (only when not hovering) */}
        {hoverIdx === null && (
          <>
            <circle cx={lastX} cy={lastY} r="8" fill="#6ee7b7" opacity="0.18">
              <animate
                attributeName="r"
                values="6;12;6"
                dur="2.4s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0.32;0;0.32"
                dur="2.4s"
                repeatCount="indefinite"
              />
            </circle>
            <circle
              cx={lastX}
              cy={lastY}
              r="3.5"
              fill={values[values.length - 1] >= 1 ? "#10b981" : "#ef4444"}
              stroke="white"
              strokeOpacity="0.85"
              strokeWidth="1.2"
            />
          </>
        )}

        {/* Y-axis min/max labels */}
        <text
          x={pad.x + 4}
          y={pad.y + 10}
          fill="currentColor"
          fillOpacity="0.45"
          fontSize="10"
        >
          {maxV.toFixed(2)}
        </text>
        <text
          x={pad.x + 4}
          y={H - pad.y - 4}
          fill="currentColor"
          fillOpacity="0.45"
          fontSize="10"
        >
          {minV.toFixed(2)}
        </text>
      </svg>

      {/* Hover tooltip */}
      {hoverIdx !== null && (
        <div
          className={`pointer-events-none absolute top-2 z-10 min-w-[130px] rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur ${
            hoverIsLoss
              ? "border-red-500/30 bg-red-950/70 text-red-100"
              : "border-emerald-500/30 bg-emerald-950/70 text-emerald-100"
          }`}
          style={tooltipStyle}
        >
          <div className="font-mono text-[10px] opacity-70">{hoverDate}</div>
          <div className="mt-0.5 flex items-baseline justify-between gap-3">
            <span className="text-[10px] opacity-70">净值</span>
            <span className="font-bold tabular-nums">{hoverV.toFixed(4)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[10px] opacity-70">收益</span>
            <span
              className={`font-semibold tabular-nums ${
                hoverPct >= 0 ? "text-emerald-300" : "text-red-300"
              }`}
            >
              {hoverPct >= 0 ? "+" : ""}
              {hoverPct.toFixed(2)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: RunInfo["status"] }) {
  const { t } = useI18n();
  const cfg: Record<
    RunInfo["status"],
    { cls: string; icon: React.ReactNode; label: string }
  > = {
    pending: {
      cls: "bg-gray-500/20 text-gray-300",
      icon: <Clock className="h-3 w-3" />,
      label: t("quant.statusPending"),
    },
    running: {
      cls: "bg-blue-500/20 text-blue-400",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      label: t("quant.statusRunning"),
    },
    done: {
      cls: "bg-emerald-500/20 text-emerald-400",
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: t("quant.statusDone"),
    },
    failed: {
      cls: "bg-red-500/20 text-red-400",
      icon: <XCircle className="h-3 w-3" />,
      label: t("quant.statusFailed"),
    },
  };
  const c = cfg[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${c.cls}`}
    >
      {c.icon}
      {c.label}
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function StrategyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useI18n();
  const runId = params.id as string;

  const [run, setRun] = useState<RunInfo | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/v1/strategies/runs/${runId}`);
      if (!res.ok) throw new Error(t("quant.detail.notFound"));
      const data = await res.json();
      setRun(data.run);
      setResults(data.results ?? null);
      setTrades(data.trades ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("quant.detail.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (runId) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Auto-poll while running
  useEffect(() => {
    if (!run || run.status === "done" || run.status === "failed") return;
    const timer = setInterval(fetchData, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <div className="text-4xl">⚠️</div>
        <p className="text-red-400">{error ?? t("quant.detail.notFound")}</p>
        <button
          onClick={() => router.back()}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20"
        >
          {t("common.back")}
        </button>
      </div>
    );
  }

  return (
    <FeatureGate feature="quant_lab" overlay>
      <div className="min-h-screen p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* ── Breadcrumb & Header ── */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Link
                href="/dashboard/quant-lab"
                className="mb-2 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300"
              >
                <ArrowLeft className="h-4 w-4" />
                Quant Lab
              </Link>
              <h1 className="text-2xl font-bold text-white">
                {run.template_name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-400">
                <span className="font-mono font-semibold text-cyan-400">
                  ${run.symbol}
                </span>
                <span>·</span>
                <span>
                  {run.start_date} → {run.end_date}
                </span>
                <span>·</span>
                <StatusBadge status={run.status} />
              </div>
            </div>
            <button
              onClick={() => router.push("/dashboard/quant-lab")}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-300 hover:bg-white/10"
            >
              <Play className="h-4 w-4 text-cyan-400" />
              {t("quant.newBacktest")}
            </button>
          </div>

          {/* ── Running / Pending state ── */}
          {(run.status === "pending" || run.status === "running") && (
            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-8 text-center">
              <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-blue-400" />
              <p className="text-lg font-semibold text-white">
                {run.status === "pending"
                  ? t("quant.detail.pendingMsg")
                  : t("quant.detail.runningMsg")}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {t("quant.detail.autoRefresh")}
              </p>
            </div>
          )}

          {/* ── Failed state ── */}
          {run.status === "failed" && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
              <p className="font-semibold text-red-400">
                {t("quant.detail.failedMsg")}
              </p>
              {run.error_msg && (
                <p className="mt-1 text-sm text-gray-500">{run.error_msg}</p>
              )}
            </div>
          )}

          {/* ── Results ── */}
          {run.status === "done" && results && (
            <>
              {/* Key Metrics */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <MetricCard
                  label={t("quant.detail.totalReturnPct")}
                  value={`${sign(results.total_return)}${pct(results.total_return)}`}
                  positive={results.total_return > 0}
                />
                <MetricCard
                  label={t("quant.detail.annualReturn")}
                  value={`${sign(results.annualized_return)}${pct(results.annualized_return)}`}
                  positive={results.annualized_return > 0}
                />
                <MetricCard
                  label={t("quant.detail.sharpe")}
                  value={results.sharpe_ratio.toFixed(2)}
                  positive={results.sharpe_ratio > 1}
                  sub={
                    results.sharpe_ratio > 2
                      ? t("quant.detail.excellent")
                      : results.sharpe_ratio > 1
                        ? t("quant.detail.good")
                        : t("quant.detail.low")
                  }
                />
                <MetricCard
                  label={t("quant.detail.maxDrawdown")}
                  value={pct(Math.abs(results.max_drawdown))}
                  positive={false}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <MetricCard
                  label={t("quant.detail.winRate")}
                  value={pct(results.win_rate)}
                  positive={results.win_rate > 0.5}
                />
                <MetricCard
                  label={t("quant.detail.trades")}
                  value={String(results.total_trades)}
                />
                <MetricCard
                  label={t("quant.detail.profitFactor")}
                  value={results.profit_factor.toFixed(2)}
                  positive={results.profit_factor > 1}
                  sub={
                    results.profit_factor > 2
                      ? t("quant.detail.excellent")
                      : results.profit_factor > 1.5
                        ? t("quant.detail.good")
                        : t("quant.detail.low")
                  }
                />
              </div>

              {/* Equity Curve */}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-semibold text-white">
                    {t("quant.detail.equityCurve")}
                  </h2>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {results.total_return >= 0 ? (
                      <TrendingUp className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-400" />
                    )}
                    <span>
                      1.0 →{" "}
                      <span
                        className={
                          results.total_return >= 0
                            ? "font-semibold text-emerald-400"
                            : "font-semibold text-red-400"
                        }
                      >
                        {(1 + results.total_return).toFixed(4)}
                      </span>
                    </span>
                  </div>
                </div>
                <EquityChart data={results.equity_curve} />
              </div>

              {/* Trade Log */}
              {trades.length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/5">
                  <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                    <h2 className="font-semibold text-white">
                      {t("quant.detail.tradeLog")}{" "}
                      <span className="ml-2 text-sm text-gray-500">
                        ({trades.length})
                      </span>
                    </h2>
                    <BarChart2 className="h-4 w-4 text-gray-600" />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/5 text-xs text-gray-600">
                          {[
                            t("quant.detail.action"),
                            t("quant.detail.entryDate"),
                            t("quant.detail.exitDate"),
                            t("quant.detail.entryPrice"),
                            t("quant.detail.exitPrice"),
                            t("quant.detail.qty"),
                            t("quant.detail.pnl"),
                            t("quant.detail.pnlPct"),
                          ].map((h, i) => (
                            <th
                              key={i}
                              className="px-4 py-3 text-left font-semibold"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {trades.map((trade, i) => {
                          const isWin = trade.pnl >= 0;
                          return (
                            <tr
                              key={trade.id ?? i}
                              className="hover:bg-white/[0.03]"
                            >
                              <td className="px-4 py-2">
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                    trade.side === "long"
                                      ? "bg-emerald-500/15 text-emerald-400"
                                      : "bg-red-500/15 text-red-400"
                                  }`}
                                >
                                  {trade.side === "long"
                                    ? t("quant.detail.sideLong")
                                    : t("quant.detail.sideShort")}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-gray-400">
                                {trade.entry_date?.slice(0, 10)}
                              </td>
                              <td className="px-4 py-2 text-gray-400">
                                {trade.exit_date?.slice(0, 10)}
                              </td>
                              <td className="px-4 py-2 text-gray-300 tabular-nums">
                                ${trade.entry_price?.toFixed(2)}
                              </td>
                              <td className="px-4 py-2 text-gray-300 tabular-nums">
                                ${trade.exit_price?.toFixed(2)}
                              </td>
                              <td className="px-4 py-2 text-gray-500 tabular-nums">
                                {trade.quantity?.toFixed(0)}
                              </td>
                              <td
                                className={`px-4 py-2 font-semibold tabular-nums ${
                                  isWin ? "text-emerald-400" : "text-red-400"
                                }`}
                              >
                                {sign(trade.pnl)}$
                                {Math.abs(trade.pnl).toFixed(0)}
                              </td>
                              <td
                                className={`px-4 py-2 tabular-nums ${
                                  isWin ? "text-emerald-400" : "text-red-400"
                                }`}
                              >
                                {sign(trade.pnl_pct)}
                                {(trade.pnl_pct * 100).toFixed(2)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Strategy Params used */}
              {run.params && Object.keys(run.params).length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <h2 className="mb-3 font-semibold text-white">
                    {t("quant.detail.usedParams")}
                  </h2>
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(run.params).map(([k, v]) => (
                      <div
                        key={k}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                      >
                        <p className="text-[10px] text-gray-500">{k}</p>
                        <p className="font-mono font-semibold text-cyan-400">
                          {v}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </FeatureGate>
  );
}
