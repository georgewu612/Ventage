"use client";

import { useEffect, useState } from "react";
import {
  BarChart2,
  ChevronRight,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { API_BASE_URL } from "@/lib/config";
import { FeatureGate } from "@/components/ui/FeatureGate";

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
      {
        type: string;
        title: string;
        minimum: number;
        maximum: number;
      }
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

// ── Category config ───────────────────────────────────────────────────────────

const CAT: Record<string, { label: string; color: string; bg: string }> = {
  trend: { label: "趋势", color: "text-cyan-400", bg: "bg-cyan-500/10" },
  mean_reversion: {
    label: "均值回归",
    color: "text-purple-400",
    bg: "bg-purple-500/10",
  },
  momentum: { label: "动量", color: "text-amber-400", bg: "bg-amber-500/10" },
  volatility: { label: "波动率", color: "text-pink-400", bg: "bg-pink-500/10" },
};

function StatusBadge({ status }: { status: Run["status"] }) {
  const cfg = {
    pending: "bg-gray-500/20 text-gray-400",
    running: "bg-blue-500/20 text-blue-400",
    done: "bg-emerald-500/20 text-emerald-400",
    failed: "bg-red-500/20 text-red-400",
  }[status];
  const label = {
    pending: "等待中",
    running: "运行中",
    done: "完成",
    failed: "失败",
  }[status];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg}`}
    >
      {label}
    </span>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function QuantLabPage() {
  const router = useRouter();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(
    null,
  );
  const [params, setParams] = useState<Record<string, number>>({});
  const [symbol, setSymbol] = useState("NVDA");
  const [startDate, setStartDate] = useState("2022-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

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

  function openTemplate(t: Template) {
    setSelectedTemplate(t);
    setParams({ ...t.default_params });
    setRunError(null);
  }

  async function startBacktest() {
    if (!selectedTemplate || !userId) return;
    setRunning(true);
    setRunError(null);
    try {
      const r = await fetch(`${API_BASE_URL}/v1/strategies/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          template_name: selectedTemplate.name,
          template_id: selectedTemplate.id,
          symbol: symbol.toUpperCase(),
          start_date: startDate,
          end_date: endDate,
          params,
          engine: "vectorbt",
        }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || "回测启动失败");
      setSelectedTemplate(null);
      setTimeout(fetchRuns, 1500);
      // Poll every 10s for 5 minutes
      let n = 0;
      const timer = setInterval(() => {
        fetchRuns();
        if (++n > 30) clearInterval(timer);
      }, 10_000);
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : "未知错误");
    } finally {
      setRunning(false);
    }
  }

  function viewResult(run: Run) {
    router.push(`/dashboard/strategies/${run.id}`);
  }

  return (
    <FeatureGate feature="quant_lab" overlay>
      <div className="min-h-screen bg-slate-900 p-6">
        <div className="mx-auto max-w-6xl">
          {/* Header */}
          <div className="mb-8 flex items-center gap-3">
            <div className="rounded-xl bg-amber-500/15 p-2.5">
              <FlaskConical className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Quant Lab</h1>
              <p className="text-sm text-gray-400">
                策略回测 · 因子研究 · 参数优化
              </p>
            </div>
            <button
              onClick={fetchRuns}
              className="ml-auto rounded-lg border border-white/10 p-2 text-gray-400 hover:bg-white/5"
              title="刷新"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {/* Templates */}
          <section className="mb-8">
            <h2 className="mb-4 text-xs font-semibold tracking-wider text-gray-500 uppercase">
              策略模板
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {templates.map((t) => {
                const cat = CAT[t.category] ?? CAT.trend;
                return (
                  <div
                    key={t.id}
                    onClick={() => openTemplate(t)}
                    className="cursor-pointer rounded-2xl border border-white/10 bg-white/5 p-5 transition-all hover:border-white/20 hover:bg-white/[0.08]"
                  >
                    <div
                      className={`mb-3 inline-flex rounded-lg ${cat.bg} px-2 py-1`}
                    >
                      <span
                        className={`text-[10px] font-semibold ${cat.color}`}
                      >
                        {cat.label}
                      </span>
                    </div>
                    <h3 className="mb-1.5 font-semibold text-white">
                      {t.name_zh}
                    </h3>
                    <p className="mb-4 text-xs leading-relaxed text-gray-500">
                      {t.description}
                    </p>
                    <button className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/5 py-2 text-xs font-medium text-gray-300 hover:bg-white/10">
                      <Play className="h-3 w-3" /> 运行回测
                    </button>
                  </div>
                );
              })}
              {templates.length === 0 && (
                <div className="col-span-4 py-12 text-center text-sm text-gray-600">
                  正在加载策略模板…
                </div>
              )}
            </div>
          </section>

          {/* History */}
          <section>
            <h2 className="mb-4 text-xs font-semibold tracking-wider text-gray-500 uppercase">
              回测历史
            </h2>
            {runs.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 py-16 text-center">
                <BarChart2 className="mx-auto mb-3 h-8 w-8 text-gray-700" />
                <p className="text-sm text-gray-500">还没有回测记录</p>
                <p className="mt-1 text-xs text-gray-600">
                  点击策略模板开始你的第一次回测
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {["策略", "标的", "区间", "状态", "创建时间", ""].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-4 py-3 text-left text-xs font-semibold text-gray-500"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {runs.map((run) => (
                      <tr key={run.id} className="hover:bg-white/[0.03]">
                        <td className="px-4 py-3 text-sm text-gray-300">
                          {run.template_name}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm font-semibold text-cyan-400">
                          {run.symbol}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {run.start_date} → {run.end_date}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={run.status} />
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {new Date(run.created_at).toLocaleDateString("zh-CN")}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {run.status === "done" && (
                            <button
                              onClick={() => viewResult(run)}
                              className="flex items-center gap-1 rounded-lg bg-cyan-500/10 px-3 py-1 text-xs text-cyan-400 hover:bg-cyan-500/20"
                            >
                              <ChevronRight className="h-3 w-3" />
                              查看结果
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
                  {selectedTemplate.description}
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
                    标的
                  </label>
                  <input
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
                    placeholder="NVDA"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-400">
                    开始
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
                    结束
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
                  策略参数
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
                    <Loader2 className="h-4 w-4 animate-spin" /> 启动中…
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" /> 开始回测
                  </>
                )}
              </button>
              <p className="mt-2 text-center text-[10px] text-gray-600">
                回测在后台运行，完成后在历史列表查看结果
              </p>
            </div>
          </div>
        </div>
      )}
    </FeatureGate>
  );
}
