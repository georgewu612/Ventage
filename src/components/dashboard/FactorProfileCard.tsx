"use client";

import { useState, useEffect, useCallback } from "react";
import { Compass, AlertTriangle } from "lucide-react";

import { API_BASE_URL } from "@/lib/config";
import { useI18n } from "@/lib/i18n/provider";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FactorScore {
  name: string;
  name_zh: string;
  raw_value: number;
  percentile: number;
  interpretation: string;
}

interface FactorProfile {
  symbol: string;
  sector: string | null;
  peer_count: number;
  factors: {
    value: FactorScore;
    quality: FactorScore;
    momentum: FactorScore;
    size: FactorScore;
    low_vol: FactorScore;
    low_inv: FactorScore;
  };
  summary: string;
  summary_zh: string;
  warnings: string[];
}

const FACTOR_ORDER = [
  "value",
  "quality",
  "momentum",
  "size",
  "low_vol",
  "low_inv",
] as const;

const FACTOR_LABELS_EN = {
  value: "Value",
  quality: "Quality",
  momentum: "Momentum",
  size: "Size",
  low_vol: "Low Vol",
  low_inv: "Low Inv",
} as const;

const FACTOR_LABELS_ZH = {
  value: "价值",
  quality: "质量",
  momentum: "动量",
  size: "小盘",
  low_vol: "低波动",
  low_inv: "低投资",
} as const;

// ── Radar chart SVG (custom, no external dep) ────────────────────────────────

function RadarChart({
  values,
  labels,
  size = 240,
}: {
  values: number[]; // 0-100 each
  labels: string[];
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.38; // leave space for labels
  const n = values.length;

  // Convert factor index to angle (0 = top, clockwise)
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;

  // Radial axes
  const axes = Array.from({ length: n }, (_, i) => {
    const a = angle(i);
    return {
      x1: cx,
      y1: cy,
      x2: cx + Math.cos(a) * maxR,
      y2: cy + Math.sin(a) * maxR,
    };
  });

  // Concentric rings (25/50/75/100%)
  const rings = [0.25, 0.5, 0.75, 1.0].map((frac) => {
    const r = maxR * frac;
    const points = Array.from({ length: n }, (_, i) => {
      const a = angle(i);
      return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
    }).join(" ");
    return { points, frac };
  });

  // Data polygon
  const dataPoints = values.map((v, i) => {
    const r = maxR * (Math.max(0, Math.min(100, v)) / 100);
    const a = angle(i);
    return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
  });

  // Label positions (slightly outside maxR)
  const labelPositions = labels.map((label, i) => {
    const a = angle(i);
    const r = maxR + 22;
    let x = cx + Math.cos(a) * r;
    let y = cy + Math.sin(a) * r;
    // Adjust text-anchor based on angle
    let anchor: "start" | "middle" | "end" = "middle";
    const cosA = Math.cos(a);
    if (cosA > 0.3) anchor = "start";
    else if (cosA < -0.3) anchor = "end";
    return { x, y, label, anchor, value: values[i] };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Concentric rings */}
      {rings.map((ring, i) => (
        <polygon
          key={i}
          points={ring.points}
          fill="none"
          stroke={i === rings.length - 1 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)"}
          strokeWidth="1"
        />
      ))}

      {/* Axes */}
      {axes.map((axis, i) => (
        <line
          key={i}
          x1={axis.x1}
          y1={axis.y1}
          x2={axis.x2}
          y2={axis.y2}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
        />
      ))}

      {/* Data polygon (filled) */}
      <polygon
        points={dataPoints.join(" ")}
        fill="rgba(139, 92, 246, 0.25)"
        stroke="rgb(139, 92, 246)"
        strokeWidth="2"
      />

      {/* Data points */}
      {values.map((v, i) => {
        const r = maxR * (Math.max(0, Math.min(100, v)) / 100);
        const a = angle(i);
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        return <circle key={i} cx={px} cy={py} r="3.5" fill="rgb(167, 139, 250)" />;
      })}

      {/* Labels */}
      {labelPositions.map((lp, i) => (
        <g key={i}>
          <text
            x={lp.x}
            y={lp.y - 4}
            textAnchor={lp.anchor}
            className="fill-white text-[11px] font-semibold"
            style={{ fill: "white" }}
          >
            {lp.label}
          </text>
          <text
            x={lp.x}
            y={lp.y + 9}
            textAnchor={lp.anchor}
            className="fill-violet-300 text-[10px] font-mono"
            style={{ fill: "#c4b5fd" }}
          >
            {lp.value.toFixed(0)}%
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── Main Card ─────────────────────────────────────────────────────────────────

export function FactorProfileCard({ symbol }: { symbol: string }) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const [data, setData] = useState<FactorProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/factors/profile/${symbol}`);
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          msg = typeof body?.detail === "string" ? body.detail : JSON.stringify(body);
        } catch {
          msg = await res.text();
        }
        throw new Error(msg);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
        <div className="mb-3 flex items-center gap-2">
          <Compass className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-semibold text-white">
            {isZh ? "因子风格画像" : "Factor Profile"}
          </span>
        </div>
        <div className="h-48 animate-pulse rounded bg-white/5" />
        <p className="mt-2 text-center text-[10px] text-gray-500">
          {isZh ? "首次加载较慢（计算同行业 30+ 只股票）..." : "First load is slow (computing 30+ peers)..."}
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
        <div className="mb-2 flex items-center gap-2">
          <Compass className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-semibold text-white">
            {isZh ? "因子风格画像" : "Factor Profile"}
          </span>
        </div>
        <p className="text-xs text-gray-500">
          {error ? (isZh ? `数据不足：${error.slice(0, 150)}` : `Insufficient data: ${error.slice(0, 150)}`) : (isZh ? "暂无数据" : "No data")}
        </p>
        {error && (
          <button
            onClick={load}
            className="mt-2 text-[11px] text-cyan-300 hover:underline"
          >
            {isZh ? "重试" : "Retry"}
          </button>
        )}
      </div>
    );
  }

  const labels = FACTOR_ORDER.map((f) =>
    isZh ? FACTOR_LABELS_ZH[f] : FACTOR_LABELS_EN[f]
  );
  const values = FACTOR_ORDER.map((f) => data.factors[f]?.percentile ?? 50);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-semibold text-white">
            {isZh ? "因子风格画像" : "Factor Profile"}
          </span>
        </div>
        <span className="text-[10px] text-gray-500">
          vs {data.peer_count} {isZh ? "同行" : "peers"}
        </span>
      </div>

      {/* Summary */}
      <div className="mb-3 rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2">
        <p className="text-[11px] text-violet-300">
          {isZh ? data.summary_zh : data.summary}
        </p>
      </div>

      {/* Radar chart */}
      <div className="mb-3 flex justify-center">
        <RadarChart values={values} labels={labels} size={260} />
      </div>

      {/* Factor list with bars */}
      <div className="space-y-1.5">
        {FACTOR_ORDER.map((f) => {
          const score = data.factors[f];
          if (!score) return null;
          const pct = score.percentile;
          const barColor =
            pct >= 75
              ? "bg-emerald-500"
              : pct >= 50
                ? "bg-cyan-500"
                : pct >= 25
                  ? "bg-amber-500"
                  : "bg-red-500/60";
          return (
            <div key={f} className="flex items-center gap-2">
              <span className="w-16 text-[11px] text-gray-400">
                {isZh ? FACTOR_LABELS_ZH[f] : FACTOR_LABELS_EN[f]}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full ${barColor} transition-all duration-500`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-10 text-right font-mono text-[10px] text-white tabular-nums">
                {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <div className="mt-3 space-y-1">
          {data.warnings.map((w, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
              <p className="text-[10px] text-amber-300">{w}</p>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[9px] text-gray-600">
        {isZh
          ? "* 百分位 = 在同行股票中的相对位置；越高 = 该因子暴露越大"
          : "* Percentile = position vs peers; higher = stronger factor exposure"}
      </p>
    </div>
  );
}
