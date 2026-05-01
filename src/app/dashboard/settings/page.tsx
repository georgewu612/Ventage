"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Save,
  Settings as SettingsIcon,
  Shield,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";

import { useI18n } from "@/lib/i18n/provider";
import { useProfile } from "@/lib/hooks/useProfile";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type RiskPref = "conservative" | "moderate" | "aggressive";

const RISK_PREF_INFO: Record<
  RiskPref,
  {
    zh: { label: string; desc: string; cap: string };
    en: { label: string; desc: string; cap: string };
  }
> = {
  conservative: {
    zh: { label: "保守", desc: "总账户敞口上限 4%", cap: "4%" },
    en: { label: "Conservative", desc: "Total exposure cap 4%", cap: "4%" },
  },
  moderate: {
    zh: { label: "稳健", desc: "总账户敞口上限 5%", cap: "5%" },
    en: { label: "Moderate", desc: "Total exposure cap 5%", cap: "5%" },
  },
  aggressive: {
    zh: { label: "进取", desc: "总账户敞口上限 6%", cap: "6%" },
    en: { label: "Aggressive", desc: "Total exposure cap 6%", cap: "6%" },
  },
};

export default function SettingsPage() {
  const { locale } = useI18n();
  const isZh = locale === "zh";
  const { profile, loading: profileLoading, refetch } = useProfile();

  const [accountSize, setAccountSize] = useState("100000");
  const [riskPref, setRiskPref] = useState<RiskPref>("moderate");
  const [maxPosPct, setMaxPosPct] = useState("25");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Hydrate form from profile
  useEffect(() => {
    if (profile) {
      if (profile.risk_account_size != null)
        setAccountSize(String(profile.risk_account_size));
      if (profile.risk_preference) setRiskPref(profile.risk_preference);
      if (profile.risk_max_position_pct != null)
        setMaxPosPct(String(profile.risk_max_position_pct));
    }
  }, [profile]);

  const save = useCallback(async () => {
    if (!profile) return;
    const size = parseFloat(accountSize.replace(/,/g, ""));
    const pct = parseFloat(maxPosPct);

    if (!size || size < 1000) {
      setErrorMsg(
        isZh ? "账户规模必须 ≥ $1,000" : "Account size must be ≥ $1,000",
      );
      setSaveStatus("error");
      return;
    }
    if (!pct || pct < 1 || pct > 100) {
      setErrorMsg(
        isZh ? "单仓上限必须在 1-100 之间" : "Max position % must be 1-100",
      );
      setSaveStatus("error");
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setSaveStatus("idle");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase
        .from("profiles")
        .update({
          risk_account_size: size,
          risk_preference: riskPref,
          risk_max_position_pct: pct,
        })
        .eq("user_id", profile.user_id);

      if (error) throw new Error(error.message);

      setSaveStatus("success");
      await refetch();
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (e) {
      setErrorMsg(String(e));
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  }, [profile, accountSize, riskPref, maxPosPct, isZh, refetch]);

  if (profileLoading) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <div className="h-8 w-48 animate-pulse rounded bg-white/10" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center">
        <p className="text-gray-400">{isZh ? "请先登录" : "Please sign in"}</p>
      </div>
    );
  }

  const accSizeNum = parseFloat(accountSize.replace(/,/g, "")) || 0;
  const examples = [
    {
      grade: "A",
      pct: 1.0,
      dollar: accSizeNum * 0.01,
      style: {
        color: "#059669",
        backgroundColor: "rgba(16, 185, 129, 0.12)",
        borderColor: "#10b981",
      },
    },
    {
      grade: "B",
      pct: 0.75,
      dollar: accSizeNum * 0.0075,
      style: {
        color: "#b45309",
        backgroundColor: "rgba(245, 158, 11, 0.12)",
        borderColor: "#f59e0b",
      },
    },
    {
      grade: "C",
      pct: 0.5,
      dollar: accSizeNum * 0.005,
      style: {
        color: "#475569",
        backgroundColor: "rgba(100, 116, 139, 0.12)",
        borderColor: "#64748b",
      },
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <SettingsIcon className="h-5 w-5 text-cyan-400" />
          <h1 className="text-2xl font-bold text-white">
            {isZh ? "设置" : "Settings"}
          </h1>
        </div>
        <p className="mt-1 text-sm text-gray-400">
          {isZh
            ? "配置交易偏好，将自动应用到信号详情和仓位计算"
            : "Configure trading preferences — applied automatically to signals & position sizing"}
        </p>
      </div>

      {/* Risk Engine Settings Card */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-4 w-4 text-violet-400" />
          <h2 className="text-base font-semibold text-white">
            {isZh ? "风控引擎配置" : "Risk Engine Configuration"}
          </h2>
        </div>

        <div className="space-y-5">
          {/* Account Size */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-300">
              <DollarSign className="h-3 w-3" />
              {isZh ? "账户规模 (USD)" : "Account Size (USD)"}
            </label>
            <input
              type="number"
              value={accountSize}
              onChange={(e) => setAccountSize(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2 text-white focus:border-violet-500 focus:outline-none"
              placeholder="100000"
              min="1000"
              step="1000"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              {isZh
                ? "用于计算每笔交易的建议股数，所有信号会基于这个规模算出仓位"
                : "Used to calculate suggested shares for every signal"}
            </p>
          </div>

          {/* Risk Preference */}
          <div>
            <label className="mb-2 block text-xs font-medium text-gray-300">
              {isZh ? "风险偏好" : "Risk Preference"}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["conservative", "moderate", "aggressive"] as RiskPref[]).map(
                (p) => {
                  const info = RISK_PREF_INFO[p][isZh ? "zh" : "en"];
                  const active = riskPref === p;
                  return (
                    <button
                      key={p}
                      onClick={() => setRiskPref(p)}
                      className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
                        active
                          ? "border-violet-500 bg-violet-500/10 ring-1 ring-violet-500/40"
                          : "border-white/10 bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      <p
                        className={`text-sm font-semibold ${
                          active ? "text-violet-300" : "text-white"
                        }`}
                      >
                        {info.label}
                      </p>
                      <p className="mt-0.5 text-[10px] text-gray-400">
                        {info.desc}
                      </p>
                    </button>
                  );
                },
              )}
            </div>
          </div>

          {/* Max Position % */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-300">
              {isZh ? "单仓最大占比 (%)" : "Max Single Position (%)"}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={maxPosPct}
                onChange={(e) => setMaxPosPct(e.target.value)}
                className="flex-1 accent-violet-500"
              />
              <span className="w-16 rounded bg-white/10 px-2 py-1 text-center font-mono text-sm text-violet-300">
                {maxPosPct}%
              </span>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              {isZh
                ? "任何单笔交易最多投入账户的多少比例（防止过度集中）"
                : "Maximum % of account in any single trade (concentration cap)"}
            </p>
          </div>
        </div>

        {/* Risk Examples Preview */}
        <div className="mt-5 rounded-lg border border-white/10 bg-slate-900/40 p-4">
          <p className="mb-2 text-[11px] font-semibold text-gray-400">
            {isZh
              ? "按当前设置，每笔交易的最大风险金额："
              : "Per-trade $ risk under current settings:"}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {examples.map((ex) => (
              <div
                key={ex.grade}
                className="rounded-md border-2 px-3 py-2.5 text-center"
                style={ex.style}
              >
                <p
                  className="text-xl font-bold"
                  style={{ color: ex.style.color }}
                >
                  {ex.grade}
                </p>
                <p
                  className="text-sm font-bold"
                  style={{ color: ex.style.color }}
                >
                  {ex.pct}%
                </p>
                <p
                  className="mt-0.5 font-mono text-sm font-semibold"
                  style={{ color: ex.style.color }}
                >
                  $
                  {ex.dollar.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Save button */}
        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving
              ? isZh
                ? "保存中…"
                : "Saving…"
              : isZh
                ? "保存配置"
                : "Save Settings"}
          </button>

          {saveStatus === "success" && (
            <div className="flex items-center gap-1.5 text-sm text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              {isZh ? "已保存" : "Saved"}
            </div>
          )}
          {saveStatus === "error" && errorMsg && (
            <div className="flex items-center gap-1.5 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4" />
              {errorMsg}
            </div>
          )}
        </div>
      </div>

      {/* Helper note */}
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-xs text-gray-400">
        <p className="mb-1 font-semibold text-cyan-300">
          💡 {isZh ? "如何使用" : "How it works"}
        </p>
        <p>
          {isZh
            ? "保存后，每个信号详情面板的「仓位计算器」会自动用你的账户规模和风险偏好计算建议股数，无需每次手动输入。"
            : "Once saved, every Signal Detail panel's Position Calculator will auto-load these values, so you don't need to enter them each time."}
        </p>
      </div>

      {/* Membership link */}
      <Link
        href="/membership"
        className="block rounded-xl border border-white/10 bg-white/5 p-4 transition-colors hover:bg-white/10"
      >
        <p className="text-sm font-semibold text-white">
          {isZh ? "会员订阅" : "Membership"}
        </p>
        <p className="mt-0.5 text-xs text-gray-400">
          {isZh
            ? `当前方案：${profile.plan} · 点击管理订阅`
            : `Current plan: ${profile.plan} · Click to manage subscription`}
        </p>
      </Link>
    </div>
  );
}
