import Link from "next/link";
import { Check, X } from "lucide-react";
import { CheckoutButton } from "@/components/billing/CheckoutButton";

const PLANS = [
  {
    key: "free",
    name: "免费版",
    price: "$0",
    period: "/月",
    desc: "适合初步了解平台",
    cta: "免费开始",
    href: "/signup",
    highlight: false,
    color: "border-white/10",
    badge: "",
  },
  {
    key: "pro",
    name: "专业版",
    price: "$29",
    period: "/月",
    desc: "适合活跃交易者与量化研究入门",
    cta: "开始专业版",
    href: "/signup",
    highlight: true,
    color: "border-cyan-500/50",
    badge: "最受欢迎",
  },
  {
    key: "premium",
    name: "旗舰版",
    price: "$99",
    period: "/月",
    desc: "完整量化研究 + AI 策略 + 组合监控",
    cta: "开始旗舰版",
    href: "/signup",
    highlight: false,
    color: "border-amber-500/30",
    badge: "全功能",
  },
];

type PlanKey = "free" | "pro" | "premium";

interface Feature {
  label: string;
  free: boolean | string;
  pro: boolean | string;
  premium: boolean | string;
}

const FEATURES: Feature[] = [
  { label: "市场雷达（基础信号）", free: true, pro: true, premium: true },
  { label: "新闻快讯", free: true, pro: true, premium: true },
  { label: "期权异动", free: false, pro: true, premium: true },
  { label: "内部交易监控", free: false, pro: true, premium: true },
  { label: "暗池大单", free: false, pro: true, premium: true },
  { label: "市场情绪分析", free: false, pro: true, premium: true },
  { label: "技术分析（K线 + 指标）", free: false, pro: true, premium: true },
  { label: "AI 分析报告", free: false, pro: true, premium: true },
  { label: "单票工作台", free: false, pro: true, premium: true },
  { label: "自选股 Watchlist", free: false, pro: true, premium: true },
  { label: "告警中心", free: false, pro: true, premium: true },
  { label: "Multi-Agent 深度分析", free: false, pro: false, premium: true },
  { label: "Quant Lab — 因子研究", free: false, pro: false, premium: true },
  { label: "策略回测引擎", free: false, pro: false, premium: true },
  { label: "参数优化 + Walk-forward", free: false, pro: false, premium: true },
  { label: "AI 策略 Copilot", free: false, pro: false, premium: true },
  { label: "组合监控 + 风险敞口", free: false, pro: false, premium: true },
  { label: "每月信号额度", free: "100 条", pro: "无限制", premium: "无限制" },
  { label: "AI 分析次数", free: "5 次/月", pro: "50 次/月", premium: "无限制" },
  { label: "数据历史深度", free: "7 天", pro: "90 天", premium: "完整" },
];

function FeatureCell({ value }: { value: boolean | string }) {
  if (typeof value === "string") {
    return <span className="text-sm font-medium text-gray-300">{value}</span>;
  }
  return value ? (
    <Check className="mx-auto h-4 w-4 text-emerald-400" />
  ) : (
    <X className="mx-auto h-4 w-4 text-gray-700" />
  );
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Nav */}
      <nav className="border-b border-white/10 px-6 py-4">
        <div className="container mx-auto flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-white">
            Ventage
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
          >
            登录
          </Link>
        </div>
      </nav>

      <main className="container mx-auto px-6 py-16">
        {/* Hero */}
        <div className="mb-16 text-center">
          <h1 className="mb-4 text-4xl font-bold text-white">
            选择适合你的方案
          </h1>
          <p className="text-lg text-gray-400">
            从基础信号监控到专业量化研究，Ventage 覆盖每一层需求
          </p>
        </div>

        {/* Plan Cards */}
        <div className="mb-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.key}
              className={`relative rounded-2xl border p-6 ${plan.color} ${
                plan.highlight
                  ? "bg-cyan-500/5 shadow-lg shadow-cyan-500/10"
                  : "bg-white/5"
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="rounded-full bg-cyan-500 px-3 py-1 text-xs font-semibold text-white">
                    {plan.badge}
                  </span>
                </div>
              )}
              <div className="mb-6">
                <h2 className="mb-1 text-xl font-bold text-white">
                  {plan.name}
                </h2>
                <p className="mb-4 text-sm text-gray-400">{plan.desc}</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-white">
                    {plan.price}
                  </span>
                  <span className="text-gray-400">{plan.period}</span>
                </div>
              </div>
              {plan.key === "free" ? (
                <Link
                  href={plan.href}
                  className="block w-full rounded-xl border border-white/10 bg-white/5 py-3 text-center text-sm font-semibold text-white transition-all hover:bg-white/10"
                >
                  {plan.cta}
                </Link>
              ) : (
                <CheckoutButton
                  plan={plan.key as "pro" | "premium"}
                  label={plan.cta}
                  className={`rounded-xl py-3 text-sm font-semibold transition-all ${
                    plan.highlight
                      ? "bg-cyan-500 text-white hover:bg-cyan-400"
                      : "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Feature Comparison Table */}
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-400">
                  功能
                </th>
                {PLANS.map((plan) => (
                  <th
                    key={plan.key}
                    className="px-4 py-4 text-center text-sm font-semibold text-white"
                  >
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {FEATURES.map((feature) => (
                <tr key={feature.label} className="hover:bg-white/3">
                  <td className="px-6 py-3 text-sm text-gray-300">
                    {feature.label}
                  </td>
                  {(["free", "pro", "premium"] as PlanKey[]).map((key) => (
                    <td key={key} className="px-4 py-3 text-center">
                      <FeatureCell value={feature[key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* FAQ */}
        <div className="mt-16 text-center">
          <p className="text-gray-400">
            有疑问？
            <a
              href="mailto:support@ventage.ai"
              className="ml-1 text-cyan-400 hover:underline"
            >
              联系我们
            </a>
          </p>
          <p className="mt-2 text-xs text-gray-600">
            所有价格以美元计价。可随时取消订阅。不满意全额退款（30天内）。
          </p>
        </div>
      </main>
    </div>
  );
}
