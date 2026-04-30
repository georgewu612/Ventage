"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BarChart2,
  ChevronRight,
  FlaskConical,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Shield,
  X,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { API_BASE_URL } from "@/lib/config";
import { FeatureGate } from "@/components/ui/FeatureGate";
import { useI18n } from "@/lib/i18n/provider";
import { useTheme } from "@/lib/theme/provider";

// ── Strategy template description i18n (frontend-side, since DB has only EN) ──
const TEMPLATE_DESC_ZH: Record<string, string> = {
  // keyed by name_zh (preferred) and name (fallback)
  "SMA 金叉死叉": "双均线交叉策略：快线上穿慢线做多，下穿做空。经典趋势跟踪。",
  "RSI 均值回归": "RSI 超卖买入（RSI<30），超买卖出（RSI>70）。适合震荡行情。",
  布林带突破: "价格突破布林带上轨做多，跌破下轨做空。捕捉突破行情。",
  "MACD 信号线交叉": "MACD 线上穿信号线做多，下穿做空。趋势确认 + 动量结合。",
  动量突破: "买入突破52周高位且成交量高于均值的股票，持续持有至趋势减弱。",
  低波防守: "在 VIX 高位时轮换至低贝塔、低波动率股票，保护资本，降低回撤。",
  // Fallback by English name as well
  sma_crossover: "双均线交叉策略：快线上穿慢线做多，下穿做空。经典趋势跟踪。",
  rsi_mean_reversion:
    "RSI 超卖买入（RSI<30），超买卖出（RSI>70）。适合震荡行情。",
  bollinger_band: "价格突破布林带上轨做多，跌破下轨做空。捕捉突破行情。",
  macd_signal: "MACD 线上穿信号线做多，下穿做空。趋势确认 + 动量结合。",
  "Momentum Breakout":
    "买入突破52周高位且成交量高于均值的股票，持续持有至趋势减弱。",
  "Low Volatility Defense":
    "在 VIX 高位时轮换至低贝塔、低波动率股票，保护资本，降低回撤。",
};

function getTemplateDescription(
  tmpl: { name: string; name_zh: string; description: string },
  isZh: boolean,
): string {
  if (!isZh) return tmpl.description;
  return (
    TEMPLATE_DESC_ZH[tmpl.name_zh] ||
    TEMPLATE_DESC_ZH[tmpl.name] ||
    tmpl.description
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Template {
  id: string;
  name: string;
  name_zh: string;
  description: string;
  category: string;
  default_params: Record<string, number>;
  params_schema: {
    properties: Record<
      string,
      { type: string; title: string; minimum: number; maximum: number }
    >;
  };
}

interface Run {
  id: string;
  template_name: string;
  symbol: string;
  start_date: string;
  end_date: string;
  status: "pending" | "running" | "done" | "failed";
  created_at: string;
}

interface WalkForwardResult {
  splits: {
    train_sharpe: number;
    test_sharpe: number;
    train_return: number;
    test_return: number;
  }[];
  consistency_score: number;
  overfitting_risk_score: number;
}

interface SensitivityResult {
  param_key: string;
  results: { param_value: number; sharpe: number; total_return_pct: number }[];
  sharpe_std: number;
  stability?: "robust" | "moderate" | "fragile" | string;
}

// ── API error helper ──────────────────────────────────────────────────────────
// FastAPI returns either { detail: "string" } or { detail: [{ loc, msg, type }, ...] }
// Without this, rendering the array in JSX produces "[object Object],[object Object]"
async function formatApiError(r: Response): Promise<string> {
  try {
    const body = await r.json();
    const d = body?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((e: { loc?: string[]; msg?: string }) => {
          const field = e.loc ? e.loc.slice(1).join(".") : "";
          return field ? `${field}: ${e.msg}` : (e.msg ?? "");
        })
        .filter(Boolean)
        .join("; ");
    }
    return r.statusText || `HTTP ${r.status}`;
  } catch {
    return r.statusText || `HTTP ${r.status}`;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, { color: string; bg: string }> = {
  trend: { color: "text-cyan-400", bg: "bg-cyan-500/10" },
  mean_reversion: { color: "text-purple-400", bg: "bg-purple-500/10" },
  momentum: { color: "text-amber-400", bg: "bg-amber-500/10" },
  volatility: { color: "text-pink-400", bg: "bg-pink-500/10" },
};

// Per-template visual theme — each strategy gets a unique color personality.
// Keyed by template `name` (DB primary key). Falls back to category color.
interface TemplateTheme {
  card: string; // gradient + border for the whole card
  hover: string; // hover state classes
  accentBar: string; // top accent bar gradient
  iconColor: string; // header icon tint
  buttonClass: string; // "运行" button bg + text
  ringColor: string; // subtle inner glow
}

// Dark-mode themes (deep saturated tints on dark slate)
const TEMPLATE_THEMES_DARK: Record<string, TemplateTheme> = {
  sma_crossover: {
    card: "border-cyan-400/25 bg-gradient-to-br from-cyan-950/40 via-slate-900/30 to-cyan-950/20",
    hover: "hover:border-cyan-400/50 hover:from-cyan-900/50",
    accentBar: "bg-gradient-to-r from-cyan-500 via-sky-400 to-blue-500",
    iconColor: "text-cyan-400",
    buttonClass:
      "bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-400/30",
    ringColor: "shadow-cyan-500/10",
  },
  rsi_mean_reversion: {
    card: "border-purple-400/25 bg-gradient-to-br from-purple-950/40 via-slate-900/30 to-purple-950/20",
    hover: "hover:border-purple-400/50 hover:from-purple-900/50",
    accentBar: "bg-gradient-to-r from-purple-500 via-fuchsia-400 to-pink-500",
    iconColor: "text-purple-400",
    buttonClass:
      "bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-400/30",
    ringColor: "shadow-purple-500/10",
  },
  bollinger_band: {
    card: "border-indigo-400/25 bg-gradient-to-br from-indigo-950/40 via-slate-900/30 to-indigo-950/20",
    hover: "hover:border-indigo-400/50 hover:from-indigo-900/50",
    accentBar: "bg-gradient-to-r from-indigo-500 via-blue-400 to-violet-500",
    iconColor: "text-indigo-400",
    buttonClass:
      "bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-400/30",
    ringColor: "shadow-indigo-500/10",
  },
  macd_signal: {
    card: "border-amber-400/25 bg-gradient-to-br from-amber-950/40 via-slate-900/30 to-amber-950/20",
    hover: "hover:border-amber-400/50 hover:from-amber-900/50",
    accentBar: "bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-500",
    iconColor: "text-amber-400",
    buttonClass:
      "bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/30",
    ringColor: "shadow-amber-500/10",
  },
  "Momentum Breakout": {
    card: "border-orange-400/25 bg-gradient-to-br from-orange-950/40 via-slate-900/30 to-red-950/20",
    hover: "hover:border-orange-400/50 hover:from-orange-900/50",
    accentBar: "bg-gradient-to-r from-orange-500 via-red-500 to-pink-500",
    iconColor: "text-orange-400",
    buttonClass:
      "bg-orange-500/20 hover:bg-orange-500/30 text-orange-200 border border-orange-400/30",
    ringColor: "shadow-orange-500/10",
  },
  "Low Volatility Defense": {
    card: "border-emerald-400/25 bg-gradient-to-br from-emerald-950/40 via-slate-900/30 to-teal-950/20",
    hover: "hover:border-emerald-400/50 hover:from-emerald-900/50",
    accentBar: "bg-gradient-to-r from-emerald-500 via-teal-400 to-green-500",
    iconColor: "text-emerald-400",
    buttonClass:
      "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-400/30",
    ringColor: "shadow-emerald-500/10",
  },
};
TEMPLATE_THEMES_DARK.momentum_breakout =
  TEMPLATE_THEMES_DARK["Momentum Breakout"];
TEMPLATE_THEMES_DARK.low_volatility_defense =
  TEMPLATE_THEMES_DARK["Low Volatility Defense"];

// Light-mode themes (pastel tints on white/slate-50)
const TEMPLATE_THEMES_LIGHT: Record<string, TemplateTheme> = {
  sma_crossover: {
    card: "border-cyan-300 bg-gradient-to-br from-cyan-50 via-white to-sky-50",
    hover: "hover:border-cyan-400 hover:shadow-cyan-200/40",
    accentBar: "bg-gradient-to-r from-cyan-500 via-sky-400 to-blue-500",
    iconColor: "text-cyan-600",
    buttonClass:
      "bg-cyan-500 hover:bg-cyan-600 text-white border border-cyan-600/20",
    ringColor: "shadow-cyan-200/30",
  },
  rsi_mean_reversion: {
    card: "border-purple-300 bg-gradient-to-br from-purple-50 via-white to-fuchsia-50",
    hover: "hover:border-purple-400 hover:shadow-purple-200/40",
    accentBar: "bg-gradient-to-r from-purple-500 via-fuchsia-400 to-pink-500",
    iconColor: "text-purple-600",
    buttonClass:
      "bg-purple-500 hover:bg-purple-600 text-white border border-purple-600/20",
    ringColor: "shadow-purple-200/30",
  },
  bollinger_band: {
    card: "border-indigo-300 bg-gradient-to-br from-indigo-50 via-white to-violet-50",
    hover: "hover:border-indigo-400 hover:shadow-indigo-200/40",
    accentBar: "bg-gradient-to-r from-indigo-500 via-blue-400 to-violet-500",
    iconColor: "text-indigo-600",
    buttonClass:
      "bg-indigo-500 hover:bg-indigo-600 text-white border border-indigo-600/20",
    ringColor: "shadow-indigo-200/30",
  },
  macd_signal: {
    card: "border-amber-300 bg-gradient-to-br from-amber-50 via-white to-orange-50",
    hover: "hover:border-amber-400 hover:shadow-amber-200/40",
    accentBar: "bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-500",
    iconColor: "text-amber-600",
    buttonClass:
      "bg-amber-500 hover:bg-amber-600 text-white border border-amber-600/20",
    ringColor: "shadow-amber-200/30",
  },
  "Momentum Breakout": {
    card: "border-orange-300 bg-gradient-to-br from-orange-50 via-white to-red-50",
    hover: "hover:border-orange-400 hover:shadow-orange-200/40",
    accentBar: "bg-gradient-to-r from-orange-500 via-red-500 to-pink-500",
    iconColor: "text-orange-600",
    buttonClass:
      "bg-orange-500 hover:bg-orange-600 text-white border border-orange-600/20",
    ringColor: "shadow-orange-200/30",
  },
  "Low Volatility Defense": {
    card: "border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-teal-50",
    hover: "hover:border-emerald-400 hover:shadow-emerald-200/40",
    accentBar: "bg-gradient-to-r from-emerald-500 via-teal-400 to-green-500",
    iconColor: "text-emerald-600",
    buttonClass:
      "bg-emerald-500 hover:bg-emerald-600 text-white border border-emerald-600/20",
    ringColor: "shadow-emerald-200/30",
  },
};
TEMPLATE_THEMES_LIGHT.momentum_breakout =
  TEMPLATE_THEMES_LIGHT["Momentum Breakout"];
TEMPLATE_THEMES_LIGHT.low_volatility_defense =
  TEMPLATE_THEMES_LIGHT["Low Volatility Defense"];

const DEFAULT_THEME: TemplateTheme = {
  card: "border-white/10 bg-white/5",
  hover: "hover:border-white/20 hover:bg-white/[0.08]",
  accentBar: "bg-gradient-to-r from-slate-500 to-slate-400",
  iconColor: "text-gray-400",
  buttonClass:
    "bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10",
  ringColor: "shadow-white/5",
};

const FACTOR_DEFS = [
  {
    key: "rsi_14",
    label: "RSI (14)",
    label_zh: "RSI (14)",
    min: 0,
    max: 100,
    goodHigh: false,
  },
  {
    key: "sma_20_50_cross",
    label: "SMA 20/50 Cross %",
    label_zh: "均线偏离 20/50 %",
    min: -15,
    max: 15,
    goodHigh: true,
  },
  {
    key: "price_momentum_20",
    label: "Momentum 20d %",
    label_zh: "20日动量 %",
    min: -30,
    max: 30,
    goodHigh: true,
  },
  {
    key: "volatility_20",
    label: "Volatility 20d %",
    label_zh: "20日波动率 %",
    min: 0,
    max: 100,
    goodHigh: false,
  },
  {
    key: "bb_position",
    label: "BB Position",
    label_zh: "布林带位置",
    min: 0,
    max: 1,
    goodHigh: true,
  },
  {
    key: "volume_ratio",
    label: "Volume Ratio",
    label_zh: "成交量比",
    min: 0,
    max: 3,
    goodHigh: true,
  },
] as const;

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-500/20 text-gray-400",
  running: "bg-blue-500/20 text-blue-400",
  done: "bg-emerald-500/20 text-emerald-400",
  failed: "bg-red-500/20 text-red-400",
};

type QuantTab =
  | "templates"
  | "factors"
  | "history"
  | "optimization"
  | "robustness";

const TABS: {
  key: QuantTab;
  zhLabel: string;
  enLabel: string;
  icon: React.ElementType;
}[] = [
  { key: "templates", zhLabel: "策略模板", enLabel: "Templates", icon: Layers },
  { key: "factors", zhLabel: "因子工作台", enLabel: "Factors", icon: Search },
  { key: "history", zhLabel: "回测历史", enLabel: "History", icon: BarChart2 },
  {
    key: "optimization",
    zhLabel: "优化结果",
    enLabel: "Optimization",
    icon: Zap,
  },
  {
    key: "robustness",
    zhLabel: "稳健性评估",
    enLabel: "Robustness",
    icon: Shield,
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Run["status"] }) {
  const { t } = useI18n();
  const cfg = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
  const label = {
    pending: t("quant.statusPending"),
    running: t("quant.statusRunning"),
    done: t("quant.statusDone"),
    failed: t("quant.statusFailed"),
  }[status];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg}`}
    >
      {label}
    </span>
  );
}

function ScoreBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className={`font-semibold ${color}`}>{value.toFixed(1)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${color.replace("text-", "bg-")}`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function QuantLabPage() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const { theme } = useTheme();
  const zh = locale === "zh";
  const TEMPLATE_THEMES =
    theme === "light" ? TEMPLATE_THEMES_LIGHT : TEMPLATE_THEMES_DARK;

  const [activeTab, setActiveTab] = useState<QuantTab>("templates");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  // Translate raw template_name (English DB key) to Chinese display label.
  // Looks up by name first, then by name_zh (in case DB stored name_zh).
  const localizeTemplateName = (rawName: string, isZh: boolean): string => {
    if (!isZh) return rawName;
    const tmpl = templates.find(
      (t) => t.name === rawName || t.name_zh === rawName,
    );
    if (tmpl) return tmpl.name_zh;
    // Fallback: convert snake_case to Title Case
    return rawName
      .split(/[_\s]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  };

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(
    null,
  );
  const [params, setParams] = useState<Record<string, number>>({});
  const [symbol, setSymbol] = useState("NVDA");
  const [startDate, setStartDate] = useState("2022-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runStage, setRunStage] = useState<string>("");

  // Factor scanner state
  const [factorSymbol, setFactorSymbol] = useState("NVDA");
  const [factorLoading, setFactorLoading] = useState(false);
  const [factorResult, setFactorResult] = useState<{
    symbol: string;
    last_price: number;
    last_date: string;
    factors: Record<string, number>;
  } | null>(null);
  const [factorError, setFactorError] = useState<string | null>(null);

  // Robustness state
  const [selectedRunId, setSelectedRunId] = useState("");
  const [nSplits, setNSplits] = useState(3);
  const [wfLoading, setWfLoading] = useState(false);
  const [wfResult, setWfResult] = useState<WalkForwardResult | null>(null);
  const [wfError, setWfError] = useState<string | null>(null);

  // Sensitivity state
  const [sensParamKey, setSensParamKey] = useState("");
  const [sensLoading, setSensLoading] = useState(false);
  const [sensResult, setSensResult] = useState<SensitivityResult | null>(null);
  const [sensError, setSensError] = useState<string | null>(null);

  useEffect(() => {
    createSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (user) setUserId(user.id);
      });
    fetchTemplates();
  }, []);

  useEffect(() => {
    if (userId) fetchRuns();
  }, [userId]);

  async function fetchTemplates() {
    try {
      const r = await fetch(`${API_BASE_URL}/v1/strategies/templates`);
      if (r.ok) setTemplates(await r.json());
    } catch {}
  }

  async function fetchRuns() {
    if (!userId) return;
    try {
      const r = await fetch(
        `${API_BASE_URL}/v1/strategies/runs?user_id=${userId}&limit=20`,
      );
      if (r.ok) setRuns(await r.json());
    } catch {}
  }

  function openTemplate(tmpl: Template) {
    setSelectedTemplate(tmpl);
    setParams({ ...tmpl.default_params });
    setRunError(null);
  }

  async function startBacktest() {
    if (!selectedTemplate || !userId) return;
    setRunning(true);
    setRunError(null);
    setRunStage(zh ? "提交中…" : "Submitting…");
    try {
      const r = await fetch(`${API_BASE_URL}/v1/strategies/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          template_name: selectedTemplate.name,
          template_id: selectedTemplate.id,
          symbol: symbol.toUpperCase().replace(/[$\s]/g, ""),
          start_date: startDate,
          end_date: endDate,
          params,
          engine: "vectorbt",
        }),
      });
      if (!r.ok) throw new Error(await formatApiError(r));
      const { run_id } = (await r.json()) as { run_id: string };

      // Poll the run status until it transitions to done/failed
      setRunStage(zh ? "回测进行中…" : "Running backtest…");
      const startTime = Date.now();
      const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes safety cap

      let finalStatus: string | null = null;
      let finalError: string | null = null;
      while (Date.now() - startTime < MAX_WAIT_MS) {
        await new Promise((res) => setTimeout(res, 2500));
        const sr = await fetch(
          `${API_BASE_URL}/v1/strategies/runs/${run_id}`,
        ).catch(() => null);
        if (!sr || !sr.ok) continue;
        // API returns { run: { status, error_msg, ... }, results, trades }
        const data = (await sr.json()) as {
          run?: { status?: string; error_msg?: string };
          status?: string;
        };
        const status = data.run?.status ?? data.status;
        if (status === "done" || status === "failed") {
          finalStatus = status;
          finalError = data.run?.error_msg ?? null;
          break;
        }
      }

      // Refresh history list so the new row shows up
      fetchRuns();

      if (finalStatus === "done") {
        setRunStage(zh ? "完成！跳转中…" : "Done! Redirecting…");
        setTimeout(() => {
          setSelectedTemplate(null);
          router.push(`/dashboard/strategies/${run_id}`);
        }, 600);
      } else if (finalStatus === "failed") {
        setRunError(
          finalError ?? (zh ? "回测失败，请检查参数后重试" : "Backtest failed"),
        );
      } else {
        setRunError(
          zh
            ? "回测耗时过长，请稍后到回测历史查看结果"
            : "Backtest is taking too long; check History later",
        );
      }
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setRunning(false);
      setRunStage("");
    }
  }

  const runFactorScan = useCallback(async () => {
    if (!factorSymbol.trim()) return;
    setFactorLoading(true);
    setFactorError(null);
    setFactorResult(null);
    try {
      const r = await fetch(`${API_BASE_URL}/v1/factors/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: factorSymbol.trim().toUpperCase(),
          period: "1y",
        }),
      });
      if (!r.ok)
        throw new Error((await r.json()).detail ?? "Factor score failed");
      setFactorResult(await r.json());
    } catch (e: unknown) {
      setFactorError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setFactorLoading(false);
    }
  }, [factorSymbol, t]);

  async function runWalkForward() {
    if (!selectedRunId) return;
    setWfLoading(true);
    setWfError(null);
    setWfResult(null);
    try {
      const r = await fetch(`${API_BASE_URL}/v1/strategies/walkforward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: selectedRunId,
          n_splits: nSplits,
          train_ratio: 0.7,
        }),
      });
      if (!r.ok) throw new Error(await formatApiError(r));
      setWfResult(await r.json());
    } catch (e: unknown) {
      setWfError(e instanceof Error ? e.message : String(e));
    } finally {
      setWfLoading(false);
    }
  }

  async function runSensitivity() {
    if (!selectedRunId || !sensParamKey) return;
    setSensLoading(true);
    setSensError(null);
    setSensResult(null);
    try {
      const r = await fetch(`${API_BASE_URL}/v1/strategies/sensitivity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: selectedRunId,
          param_key: sensParamKey,
          range_min: 5,
          range_max: 50,
          steps: 6,
        }),
      });
      if (!r.ok) throw new Error(await formatApiError(r));
      setSensResult(await r.json());
    } catch (e: unknown) {
      setSensError(e instanceof Error ? e.message : String(e));
    } finally {
      setSensLoading(false);
    }
  }

  const doneRuns = runs.filter((r) => r.status === "done");

  return (
    <FeatureGate feature="quant_lab" overlay>
      <div className="min-h-screen bg-slate-900 p-6">
        <div className="mx-auto max-w-6xl">
          {/* Header */}
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-xl bg-amber-500/15 p-2.5">
              <FlaskConical className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Quant Lab</h1>
              <p className="text-sm text-gray-400">
                {zh ? "量化研究工作台" : "Quantitative Research Workbench"}
              </p>
            </div>
            <button
              onClick={fetchRuns}
              className="ml-auto rounded-lg border border-white/10 p-2 text-gray-400 hover:bg-white/5"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {/* Tab bar */}
          <div className="mb-6 flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-all ${
                    activeTab === tab.key
                      ? "bg-amber-500/20 font-semibold text-amber-200"
                      : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">
                    {zh ? tab.zhLabel : tab.enLabel}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Tab 1: Strategy Templates ── */}
          {activeTab === "templates" && (
            <section>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {templates.map((tmpl) => {
                  const catColors =
                    CAT_COLORS[tmpl.category] ?? CAT_COLORS.trend;
                  const catLabel =
                    {
                      trend: t("quant.catTrend"),
                      mean_reversion: t("quant.catMeanReversion"),
                      momentum: t("quant.catMomentum"),
                      volatility: t("quant.catVolatility"),
                    }[tmpl.category] ?? tmpl.category;
                  const tmplTheme =
                    TEMPLATE_THEMES[tmpl.name] ??
                    TEMPLATE_THEMES[tmpl.name_zh] ??
                    DEFAULT_THEME;
                  return (
                    <div
                      key={tmpl.id}
                      onClick={() => openTemplate(tmpl)}
                      className={`group relative cursor-pointer overflow-hidden rounded-2xl border p-5 shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${tmplTheme.card} ${tmplTheme.hover} ${tmplTheme.ringColor}`}
                    >
                      {/* Top accent bar — visible on hover via opacity */}
                      <div
                        className={`absolute inset-x-0 top-0 h-0.5 opacity-50 transition-opacity group-hover:opacity-100 ${tmplTheme.accentBar}`}
                      />

                      {/* Strategy icon + category badge row */}
                      <div className="mb-3 flex items-start justify-between">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-xl border backdrop-blur ${
                            theme === "light"
                              ? "border-slate-200 bg-white/80 shadow-sm"
                              : "border-white/10 bg-black/20"
                          }`}
                        >
                          <FlaskConical
                            className={`h-5 w-5 ${tmplTheme.iconColor}`}
                          />
                        </div>
                        <div
                          className={`inline-flex rounded-md ${catColors.bg} px-2 py-0.5`}
                        >
                          <span
                            className={`text-[10px] font-semibold ${catColors.color}`}
                          >
                            {catLabel}
                          </span>
                        </div>
                      </div>

                      <h3
                        className={`mb-1.5 text-base font-semibold ${theme === "light" ? "text-slate-900" : "text-white"}`}
                      >
                        {tmpl.name_zh}
                      </h3>
                      <p
                        className={`mb-4 line-clamp-3 text-xs leading-relaxed ${theme === "light" ? "text-slate-600" : "text-gray-400"}`}
                      >
                        {getTemplateDescription(tmpl, zh)}
                      </p>
                      <button
                        className={`flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${tmplTheme.buttonClass}`}
                      >
                        <Play className="h-3 w-3" /> {t("quant.run")}
                      </button>
                    </div>
                  );
                })}
                {templates.length === 0 && (
                  <div className="col-span-4 py-12 text-center text-sm text-gray-600">
                    {t("common.loading")}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── Tab 2: Factor Workbench ── */}
          {activeTab === "factors" && (
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="mb-4 flex gap-3">
                <input
                  value={factorSymbol}
                  onChange={(e) =>
                    setFactorSymbol(e.target.value.toUpperCase())
                  }
                  onKeyDown={(e) => e.key === "Enter" && runFactorScan()}
                  placeholder="NVDA"
                  className="w-36 rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none"
                />
                <button
                  onClick={runFactorScan}
                  disabled={factorLoading}
                  className="flex items-center gap-2 rounded-lg bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
                >
                  {factorLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  {t("quant.scanFactors")}
                </button>
                {factorResult && (
                  <span className="ml-auto self-center text-xs text-gray-500">
                    ${factorResult.symbol} · $
                    {factorResult.last_price.toFixed(2)} ·{" "}
                    {factorResult.last_date}
                  </span>
                )}
              </div>
              {factorError && (
                <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {factorError}
                </p>
              )}
              {factorResult && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {FACTOR_DEFS.map(
                    ({ key, label, label_zh, min, max, goodHigh }) => {
                      const raw = factorResult.factors[key] ?? 0;
                      const clamped = Math.max(min, Math.min(max, raw));
                      const pct = ((clamped - min) / (max - min)) * 100;
                      const isGood = goodHigh
                        ? raw > (min + max) / 2
                        : raw < (min + max) / 2;
                      const barColor = isGood ? "bg-emerald-500" : "bg-red-500";
                      const textColor = isGood
                        ? "text-emerald-400"
                        : "text-red-400";
                      return (
                        <div
                          key={key}
                          className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-400">
                              {zh ? label_zh : label}
                            </span>
                            <span
                              className={`text-sm font-bold tabular-nums ${textColor}`}
                            >
                              {raw.toFixed(2)}
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className={`h-full transition-all duration-500 ${barColor}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="mt-1 flex justify-between text-[10px] text-gray-600">
                            <span>{min}</span>
                            <span>{max}</span>
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              )}
              {!factorResult && !factorLoading && !factorError && (
                <p className="py-6 text-center text-sm text-gray-600">
                  {t("quant.scanHint")}
                </p>
              )}
            </section>
          )}

          {/* ── Tab 3: Run History ── */}
          {activeTab === "history" && (
            <section>
              {runs.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 py-16 text-center">
                  <BarChart2 className="mx-auto mb-3 h-8 w-8 text-gray-700" />
                  <p className="text-sm text-gray-500">{t("quant.noRuns")}</p>
                  <p className="mt-1 text-xs text-gray-600">
                    {t("quant.noRunsHint")}
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-white/10">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        {[
                          t("quant.templates"),
                          t("quant.symbol"),
                          t("quant.startDate"),
                          t("common.status"),
                          t("quant.detail.date"),
                          "",
                        ].map((h) => (
                          <th
                            key={h}
                            className="px-4 py-3 text-left text-xs font-semibold text-gray-500"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {runs.map((run) => (
                        <tr key={run.id} className="hover:bg-white/[0.03]">
                          <td className="px-4 py-3 text-sm text-gray-300">
                            {localizeTemplateName(run.template_name, zh)}
                          </td>
                          <td className="px-4 py-3 font-mono text-sm font-semibold text-cyan-400">
                            {run.symbol.replace(/^\$+/, "")}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {run.start_date} → {run.end_date}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={run.status} />
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600">
                            {new Date(run.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {run.status === "done" && (
                              <button
                                onClick={() =>
                                  router.push(`/dashboard/strategies/${run.id}`)
                                }
                                className="flex items-center gap-1 rounded-lg bg-cyan-500/10 px-3 py-1 text-xs text-cyan-400 hover:bg-cyan-500/20"
                              >
                                <ChevronRight className="h-3 w-3" />{" "}
                                {t("quant.viewResult")}
                              </button>
                            )}
                            {run.status === "running" && (
                              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ── Tab 4: Optimization Results ── */}
          {activeTab === "optimization" && (
            <section className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="mb-3 text-xs font-semibold tracking-wide text-gray-500">
                  {zh ? "参数敏感性分析" : "PARAMETER SENSITIVITY"}
                </p>
                <div className="mb-4 flex flex-wrap gap-3">
                  <select
                    value={selectedRunId}
                    onChange={(e) => setSelectedRunId(e.target.value)}
                    className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white"
                  >
                    <option value="">{zh ? "选择回测" : "Select run"}</option>
                    {doneRuns.map((r) => (
                      <option key={r.id} value={r.id}>
                        {localizeTemplateName(r.template_name, zh)} / {r.symbol}{" "}
                        / {r.start_date}
                      </option>
                    ))}
                  </select>
                  <input
                    value={sensParamKey}
                    onChange={(e) => setSensParamKey(e.target.value)}
                    placeholder={
                      zh
                        ? "参数名（如 快线周期）"
                        : "param_key (e.g. fast_window)"
                    }
                    className="w-52 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white placeholder-gray-600"
                  />
                  <button
                    onClick={runSensitivity}
                    disabled={sensLoading || !selectedRunId || !sensParamKey}
                    className="flex items-center gap-2 rounded-lg bg-purple-500/20 px-4 py-2 text-sm font-semibold text-purple-300 hover:bg-purple-500/30 disabled:opacity-40"
                  >
                    {sensLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Zap className="h-4 w-4" />
                    )}
                    {zh ? "运行敏感性分析" : "Run Sensitivity"}
                  </button>
                </div>
                {sensError && (
                  <p className="text-xs text-red-400">{sensError}</p>
                )}
                {sensResult && (
                  <div>
                    <p className="mb-2 text-xs text-gray-500">
                      {zh ? "Sharpe 稳定性" : "Sharpe Stability"}: σ ={" "}
                      {sensResult.sharpe_std.toFixed(3)}
                      <span
                        className={`ml-2 font-semibold ${sensResult.sharpe_std < 0.3 ? "text-emerald-400" : sensResult.sharpe_std < 0.6 ? "text-yellow-400" : "text-red-400"}`}
                      >
                        {sensResult.sharpe_std < 0.3
                          ? zh
                            ? "稳健"
                            : "Robust"
                          : sensResult.sharpe_std < 0.6
                            ? zh
                              ? "一般"
                              : "Moderate"
                            : zh
                              ? "脆弱"
                              : "Fragile"}
                      </span>
                    </p>
                    <div className="flex h-20 items-end gap-1">
                      {(() => {
                        const items = sensResult.results ?? [];
                        const maxAbs = Math.max(
                          1e-9,
                          ...items.map((it) => Math.abs(it.sharpe)),
                        );
                        return items.map((it, i) => {
                          const h = Math.max(
                            4,
                            (Math.abs(it.sharpe) / maxAbs) * 72,
                          );
                          return (
                            <div
                              key={i}
                              className="flex flex-1 flex-col items-center gap-0.5"
                              title={`${it.param_value}: Sharpe ${it.sharpe.toFixed(2)} · 收益 ${it.total_return_pct.toFixed(1)}%`}
                            >
                              <div
                                className={`w-full rounded-sm ${it.sharpe >= 0 ? "bg-emerald-500/60" : "bg-red-500/60"}`}
                                style={{ height: `${h}px` }}
                              />
                              <span className="text-[9px] text-gray-600">
                                {it.param_value}
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}
                {!sensResult && !sensLoading && (
                  <p className="py-4 text-center text-xs text-gray-600">
                    {zh
                      ? "选择一个已完成的回测并输入参数名以运行分析"
                      : "Select a completed run and enter a param key to analyze"}
                  </p>
                )}
              </div>
            </section>
          )}

          {/* ── Tab 5: Robustness Assessment ── */}
          {activeTab === "robustness" && (
            <section className="space-y-4">
              {/* Walk-forward trigger */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="mb-3 text-xs font-semibold tracking-wide text-gray-500">
                  {zh ? "滚动前向稳健性验证" : "WALK-FORWARD ROBUSTNESS"}
                </p>
                <div className="mb-4 flex flex-wrap gap-3">
                  <select
                    value={selectedRunId}
                    onChange={(e) => setSelectedRunId(e.target.value)}
                    className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white"
                  >
                    <option value="">
                      {zh ? "选择已完成回测" : "Select completed run"}
                    </option>
                    {doneRuns.map((r) => (
                      <option key={r.id} value={r.id}>
                        {localizeTemplateName(r.template_name, zh)} / {r.symbol}{" "}
                        / {r.start_date}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400">
                      {zh ? "分段数" : "Splits"}
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={6}
                      value={nSplits}
                      onChange={(e) => setNSplits(Number(e.target.value))}
                      className="w-16 rounded-lg border border-white/10 bg-slate-800 px-2 py-2 text-sm text-white"
                    />
                  </div>
                  <button
                    onClick={runWalkForward}
                    disabled={wfLoading || !selectedRunId}
                    className="flex items-center gap-2 rounded-lg bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
                  >
                    {wfLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Shield className="h-4 w-4" />
                    )}
                    {zh ? "运行稳健性回测" : "Run Walk-Forward"}
                  </button>
                </div>
                {wfError && <p className="text-xs text-red-400">{wfError}</p>}

                {wfResult && (
                  <div className="space-y-4">
                    {/* Scores */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <ScoreBar
                          label={
                            zh
                              ? "一致性得分（越高越好）"
                              : "Consistency Score (higher = better)"
                          }
                          value={wfResult.consistency_score}
                          color={
                            wfResult.consistency_score >= 70
                              ? "text-emerald-400"
                              : wfResult.consistency_score >= 40
                                ? "text-yellow-400"
                                : "text-red-400"
                          }
                        />
                      </div>
                      <div>
                        <ScoreBar
                          label={
                            zh
                              ? "过拟合风险（越低越好）"
                              : "Overfitting Risk (lower = better)"
                          }
                          value={wfResult.overfitting_risk_score}
                          color={
                            wfResult.overfitting_risk_score < 30
                              ? "text-emerald-400"
                              : wfResult.overfitting_risk_score < 60
                                ? "text-yellow-400"
                                : "text-red-400"
                          }
                        />
                      </div>
                    </div>

                    {/* Splits table */}
                    <div className="overflow-hidden rounded-lg border border-white/10">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10 bg-white/5 text-xs text-gray-500">
                            <th className="px-3 py-2 text-left">
                              {zh ? "窗口" : "Window"}
                            </th>
                            <th className="px-3 py-2 text-right">
                              {zh ? "训练 Sharpe" : "Train Sharpe"}
                            </th>
                            <th className="px-3 py-2 text-right">
                              {zh ? "测试 Sharpe" : "Test Sharpe"}
                            </th>
                            <th className="px-3 py-2 text-right">
                              {zh ? "训练收益" : "Train Return"}
                            </th>
                            <th className="px-3 py-2 text-right">
                              {zh ? "测试收益" : "Test Return"}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {wfResult.splits.map((split, i) => (
                            <tr key={i} className="hover:bg-white/[0.03]">
                              <td className="px-3 py-2 text-gray-400">
                                #{i + 1}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-cyan-400">
                                {split.train_sharpe.toFixed(2)}
                              </td>
                              <td
                                className={`px-3 py-2 text-right font-mono ${split.test_sharpe >= 0 ? "text-emerald-400" : "text-red-400"}`}
                              >
                                {split.test_sharpe.toFixed(2)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-gray-300">
                                {(split.train_return * 100).toFixed(1)}%
                              </td>
                              <td
                                className={`px-3 py-2 text-right font-mono ${split.test_return >= 0 ? "text-emerald-400" : "text-red-400"}`}
                              >
                                {(split.test_return * 100).toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[10px] text-gray-600">
                      ⚠️{" "}
                      {zh
                        ? "Walk-forward 测试结果仅供参考，不代表未来实盘表现"
                        : "Walk-forward results are for reference only and do not guarantee live performance"}
                    </p>
                  </div>
                )}

                {!wfResult && !wfLoading && (
                  <p className="py-4 text-center text-xs text-gray-600">
                    {zh
                      ? "选择一个已完成的回测，然后点击运行以评估策略稳健性"
                      : "Select a completed run and click Run to evaluate strategy robustness"}
                  </p>
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Backtest Config Modal */}
      {selectedTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-5">
              <div>
                <h2 className="font-bold text-white">
                  {selectedTemplate.name_zh}
                </h2>
                <p className="text-xs text-gray-500">
                  {getTemplateDescription(selectedTemplate, zh)}
                </p>
              </div>
              <button
                onClick={() => setSelectedTemplate(null)}
                className="text-gray-500 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-400">
                    {t("quant.symbol")}
                  </label>
                  <input
                    value={symbol}
                    onChange={(e) =>
                      setSymbol(
                        e.target.value.toUpperCase().replace(/[$\s]/g, ""),
                      )
                    }
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
                    placeholder="NVDA"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-400">
                    {t("quant.startDate")}
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-400">
                    {t("quant.endDate")}
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold tracking-wider text-gray-500 uppercase">
                  {t("quant.detail.params")}
                </label>
                <div className="space-y-3">
                  {Object.entries(
                    selectedTemplate.params_schema?.properties ?? {},
                  ).map(([key, schema]) => (
                    <div key={key}>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="text-xs text-gray-400">
                          {schema.title}
                        </label>
                        <span className="text-xs font-semibold text-cyan-400">
                          {params[key] ?? selectedTemplate.default_params[key]}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={schema.minimum}
                        max={schema.maximum}
                        step={schema.type === "integer" ? 1 : 0.1}
                        value={
                          params[key] ?? selectedTemplate.default_params[key]
                        }
                        onChange={(e) =>
                          setParams((p) => ({
                            ...p,
                            [key]:
                              schema.type === "integer"
                                ? parseInt(e.target.value)
                                : parseFloat(e.target.value),
                          }))
                        }
                        className="w-full accent-cyan-500"
                      />
                      <div className="flex justify-between text-[10px] text-gray-600">
                        <span>{schema.minimum}</span>
                        <span>{schema.maximum}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {runError && (
                <p className="rounded-lg bg-red-500/10 p-3 text-xs text-red-400">
                  {runError}
                </p>
              )}
            </div>
            <div className="border-t border-white/10 p-5">
              <button
                onClick={startBacktest}
                disabled={running}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-3 text-sm font-semibold text-white hover:bg-cyan-400 disabled:opacity-50"
              >
                {running ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />{" "}
                    {runStage || t("common.loading")}
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" /> {t("quant.newBacktest")}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeatureGate>
  );
}
