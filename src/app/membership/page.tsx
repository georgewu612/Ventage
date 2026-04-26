"use client";

import Link from "next/link";
import { CreditCard, Shield, Star, Zap } from "lucide-react";

import { ManageSubscriptionButton } from "@/components/billing/ManageSubscriptionButton";
import { PLAN_LABELS } from "@/lib/features/gates";
import { useProfile } from "@/lib/hooks/useProfile";
import { useI18n } from "@/lib/i18n/provider";

const PLAN_FEATURES: Record<string, { zh: string[]; en: string[] }> = {
  free: {
    zh: ["市场雷达（基础信号）", "新闻快讯", "100条/月信号", "5次/月 AI 分析"],
    en: [
      "Market Radar (basic signals)",
      "News Feed",
      "100 signals/month",
      "5 AI analyses/month",
    ],
  },
  pro: {
    zh: [
      "全部免费版功能",
      "期权异动 · 暗池 · 内部交易",
      "单票工作台 + 历史类比分析",
      "监控触发点 + AI 策略匹配",
      "告警中心 · 盘前/收盘/周报",
      "无限信号 · 50次/月 AI 分析",
    ],
    en: [
      "All Free features",
      "Options Flow · Dark Pool · Insider Trades",
      "Stock Workbench + Historical Analog",
      "Monitoring Triggers + AI Strategy Match",
      "Alerts · Pre-Market / Closing / Weekly Reports",
      "Unlimited signals · 50 AI analyses/month",
    ],
  },
  premium: {
    zh: [
      "全部专业版功能",
      "Multi-Agent 深度分析",
      "Quant Lab 因子研究 + Walk-forward",
      "策略回测 + 参数优化",
      "AI 组合构建器",
      "无限 AI 分析次数",
    ],
    en: [
      "All Pro features",
      "Multi-Agent Deep Analysis",
      "Quant Lab Factor Research + Walk-Forward",
      "Strategy Backtest + Parameter Optimization",
      "AI Portfolio Builder",
      "Unlimited AI analyses",
    ],
  },
};

export default function MembershipPage() {
  const { locale } = useI18n();
  const { profile, plan, loading } = useProfile();
  const zh = locale === "zh";

  const planInfo =
    PLAN_LABELS[plan as keyof typeof PLAN_LABELS] ?? PLAN_LABELS.free;
  const features = PLAN_FEATURES[plan] ?? PLAN_FEATURES.free;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Nav */}
      <nav className="border-b border-white/10 px-6 py-4">
        <div className="container mx-auto flex items-center justify-between">
          <Link href="/dashboard" className="text-xl font-bold text-white">
            Ventage
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
          >
            {zh ? "返回看板" : "Back to Dashboard"}
          </Link>
        </div>
      </nav>

      <main className="container mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-2 text-3xl font-bold text-white">
          {zh ? "我的会员" : "My Membership"}
        </h1>
        <p className="mb-10 text-gray-400">
          {zh
            ? "管理你的订阅状态与账户权益"
            : "Manage your subscription and account benefits"}
        </p>

        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-2xl bg-white/5"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Current plan card */}
            <div
              className={`rounded-2xl border p-6 ${
                plan === "premium"
                  ? "border-amber-500/30 bg-amber-500/5"
                  : plan === "pro"
                    ? "border-cyan-500/30 bg-cyan-500/5"
                    : "border-white/10 bg-white/5"
              }`}
            >
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    {plan === "premium" ? (
                      <Star className="h-5 w-5 text-amber-400" />
                    ) : plan === "pro" ? (
                      <Zap className="h-5 w-5 text-cyan-400" />
                    ) : (
                      <Shield className="h-5 w-5 text-gray-400" />
                    )}
                    <h2 className="text-lg font-bold text-white">
                      {zh ? planInfo.zh : planInfo.en}
                    </h2>
                  </div>
                  {profile?.display_name && (
                    <p className="text-sm text-gray-500">
                      {profile.display_name}
                    </p>
                  )}
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-sm font-semibold ${planInfo.color}`}
                >
                  {zh ? planInfo.zh : planInfo.en}
                </span>
              </div>

              {/* Feature list */}
              <div className="mb-5 space-y-2">
                {(zh ? features.zh : features.en).map((f) => (
                  <div
                    key={f}
                    className="flex items-center gap-2 text-sm text-gray-300"
                  >
                    <div className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                    {f}
                  </div>
                ))}
              </div>

              {/* Action buttons */}
              {plan !== "free" ? (
                <ManageSubscriptionButton />
              ) : (
                <Link
                  href="/pricing"
                  className="flex items-center justify-center gap-2 rounded-xl bg-cyan-500 py-3 text-sm font-semibold text-white hover:bg-cyan-400"
                >
                  <Zap className="h-4 w-4" />
                  {zh
                    ? "升级解锁全部功能 →"
                    : "Upgrade to unlock all features →"}
                </Link>
              )}
            </div>

            {/* Upgrade prompt for pro users */}
            {plan === "pro" && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6">
                <div className="mb-3 flex items-center gap-2">
                  <Star className="h-5 w-5 text-amber-400" />
                  <h3 className="font-semibold text-white">
                    {zh ? "升级旗舰版" : "Upgrade to Premium"}
                  </h3>
                </div>
                <p className="mb-4 text-sm text-gray-400">
                  {zh
                    ? "解锁 AI 组合构建器、Walk-forward 稳健性评估、无限 AI 分析次数"
                    : "Unlock AI Portfolio Builder, Walk-forward robustness, and unlimited AI analyses"}
                </p>
                <Link
                  href="/pricing"
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500/20 px-5 py-2.5 text-sm font-semibold text-amber-300 hover:bg-amber-500/30"
                >
                  <CreditCard className="h-4 w-4" />
                  {zh ? "查看旗舰版方案" : "View Premium Plan"}
                </Link>
              </div>
            )}

            {/* Pricing link for all users */}
            <div className="text-center">
              <Link
                href="/pricing"
                className="text-sm text-gray-500 hover:text-cyan-400"
              >
                {zh ? "查看所有方案对比 →" : "Compare all plans →"}
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
