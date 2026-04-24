import Link from "next/link";
import {
  BarChart3,
  Brain,
  DollarSign,
  FlaskConical,
  Globe,
  Layers,
  Radio,
  Shield,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

const FEATURES = [
  {
    icon: Radio,
    title: "Market Regime Engine",
    title_zh: "市场环境引擎",
    desc: "Daily risk-on / neutral / risk-off regime detection using VIX, SPY 200-day MA, market breadth and options flow. Color-coded posture recommendation.",
    desc_zh:
      "每日基于 VIX、SPY 200 日均线、市场宽度、P/C 比率判断市场环境（风险偏好/中性/规避），一键获取当日仓位建议。",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    badge: "NEW",
  },
  {
    icon: Brain,
    title: "Desk Consensus",
    title_zh: "多台联席共识",
    desc: "4-desk AI verdict (Technical / Flow / Event / Risk) synthesized into one structured consensus with strategy fit scoring.",
    desc_zh:
      "技术台、资金流台、事件台、风险台四个专业 AI 分析台联席，生成结构化最终判断与策略契合度评分。",
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    badge: "NEW",
  },
  {
    icon: TrendingUp,
    title: "AI Market Signals",
    title_zh: "AI 市场信号",
    desc: "Multi-dimensional signals from technicals, options flow, insider trades and sentiment — real-time scoring and alerts.",
    desc_zh: "技术面、期权异动、内部交易、情绪多维度信号，实时评分与告警。",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  {
    icon: DollarSign,
    title: "Options Flow",
    title_zh: "期权异动监控",
    desc: "Unusual sweep scanner, Call/Put ratio, strike distribution — catch institutional positioning before it moves.",
    desc_zh: "异常大单扫描、Call/Put 比率、行权价分布，捕捉机构动向。",
    color: "text-sky-400",
    bg: "bg-sky-500/10",
  },
  {
    icon: Layers,
    title: "Dark Pool Tracker",
    title_zh: "暗池大宗追踪",
    desc: "FINRA OTC real-time large-block monitoring. Whale capital flows visible at a glance.",
    desc_zh: "FINRA OTC 场外大单实时监控，鲸鱼资金动向一目了然。",
    color: "text-purple-400",
    bg: "bg-purple-500/10",
  },
  {
    icon: Users,
    title: "Insider Trade Radar",
    title_zh: "内部交易雷达",
    desc: "SEC Form 4 real-time parsing — smart separation of buys, sells, RSU grants and tax withholding.",
    desc_zh: "SEC Form 4 实时解析，高管买卖、RSU 授予与税款代扣智能区分。",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
  },
  {
    icon: Users,
    title: "7-Agent AI Analysis",
    title_zh: "7-Agent AI 分析",
    desc: "Fundamentals, sentiment, technicals, news, bull/bear debate and risk control — 7 agents collaborate on one trading decision.",
    desc_zh:
      "基本面、情绪、技术、新闻、多空辩论、风控 7 个专业 Agent 协作生成交易决策。",
    color: "text-pink-400",
    bg: "bg-pink-500/10",
  },
  {
    icon: FlaskConical,
    title: "Quant Lab",
    title_zh: "Quant Lab（即将上线）",
    desc: "Alpha factor research, vectorbt backtesting engine, walk-forward validation and parameter optimization.",
    desc_zh: "Alpha 因子研究、vectorbt 回测引擎、Walk-forward 验证与参数优化。",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
];

const STATS = [
  { value: "4", label_zh: "AI 分析台", label_en: "AI Desks" },
  { value: "7", label_zh: "专业 AI Agent", label_en: "AI Agents" },
  { value: "5+", label_zh: "数据源", label_en: "Data Sources" },
  { value: "中英", label_zh: "双语支持", label_en: "Bilingual" },
];

const REGIME_DEMO = {
  label: "Neutral",
  vix: "19.3",
  ma: "+6.5%",
  breadth: "Weak",
  posture: "Balanced",
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Nav */}
      <nav className="border-b border-white/10 px-6 py-4">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-cyan-400" />
            <span className="text-lg font-bold text-white">Ventage</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/pricing"
              className="text-sm text-gray-400 hover:text-white"
            >
              定价 / Pricing
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
            >
              登录 / Login
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-400"
            >
              免费开始 / Start Free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="container mx-auto px-6 py-24 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1.5 text-sm text-cyan-300">
          <Zap className="h-3.5 w-3.5" />
          AI-Powered Institutional Market Intelligence
        </div>
        <h1 className="mx-auto mb-4 max-w-4xl text-5xl leading-tight font-bold text-white">
          专业级 AI 股票分析
          <br />
          <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
            Regime Engine · Desk Consensus
          </span>
        </h1>
        <p className="mx-auto mb-3 max-w-2xl text-lg text-gray-400">
          Ventage 聚合期权异动、暗池大单、内部交易、市场情绪与 AI
          多台联席分析，每日生成市场环境判断与个股多台共识报告。
        </p>
        <p className="mx-auto mb-10 max-w-2xl text-base text-gray-500">
          Aggregating options flow, dark pool, insider trades, sentiment and
          multi-desk AI consensus — institutional-grade signals for active
          traders.
        </p>
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/signup"
            className="rounded-xl bg-cyan-500 px-8 py-3.5 text-base font-semibold text-white transition-colors hover:bg-cyan-400"
          >
            免费注册体验
          </Link>
          <Link
            href="/pricing"
            className="rounded-xl border border-white/10 px-8 py-3.5 text-base font-medium text-gray-300 transition-colors hover:bg-white/5"
          >
            查看定价方案
          </Link>
        </div>

        {/* Stats */}
        <div className="mt-16 grid grid-cols-2 gap-6 sm:grid-cols-4">
          {STATS.map(({ value, label_zh, label_en }) => (
            <div key={label_en}>
              <p className="text-3xl font-bold text-white">{value}</p>
              <p className="mt-1 text-sm text-gray-500">
                {label_zh} · {label_en}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Live Regime Preview */}
      <section className="container mx-auto px-6 pb-16">
        <div className="mx-auto max-w-2xl">
          <p className="mb-4 text-center text-xs font-semibold tracking-wider text-slate-500 uppercase">
            今日市场环境 · Live Market Pulse
          </p>
          <div className="rounded-2xl border border-yellow-500/25 bg-yellow-500/5 p-5">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex items-center gap-1.5 rounded-full border border-yellow-500/40 bg-yellow-500/20 px-4 py-1.5 text-sm font-bold text-yellow-300">
                <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
                {REGIME_DEMO.label}
              </span>
              <span className="text-xs text-slate-400">
                Confidence 62% · Updated daily at 09:31 ET
              </span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "VIX", value: REGIME_DEMO.vix },
                {
                  label: "SPY vs 200MA",
                  value: REGIME_DEMO.ma,
                  positive: true,
                },
                { label: "Breadth", value: REGIME_DEMO.breadth },
                { label: "Posture", value: REGIME_DEMO.posture },
              ].map(({ label, value, positive }) => (
                <div key={label} className="rounded-lg bg-white/5 px-3 py-2">
                  <p className="mb-0.5 text-[10px] text-slate-400">{label}</p>
                  <p
                    className={`text-sm font-semibold ${positive ? "text-emerald-400" : "text-white"}`}
                  >
                    {value}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-400">
              Market is in Neutral mode. VIX=19.3, SPY is 6.5% above its 200-day
              MA. Breadth is weak, style bias is mixed. Recommended posture:
              balanced.
            </p>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="container mx-auto px-6 py-16">
        <h2 className="mb-3 text-center text-3xl font-bold text-white">
          覆盖每一个交易决策维度
        </h2>
        <p className="mb-12 text-center text-gray-500">
          Full coverage of every trading decision dimension
        </p>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(
            ({ icon: Icon, title, title_zh, desc_zh, color, bg, badge }) => (
              <div
                key={title}
                className="relative rounded-2xl border border-white/10 bg-white/5 p-5 transition-all hover:border-white/20 hover:bg-white/[0.08]"
              >
                {badge && (
                  <span className="absolute top-3 right-3 rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                    {badge}
                  </span>
                )}
                <div className={`mb-3 inline-flex rounded-xl ${bg} p-2.5`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
                <h3 className="mb-0.5 text-sm font-bold text-white">{title}</h3>
                <p className="mb-2 text-xs text-gray-500">{title_zh}</p>
                <p className="text-xs leading-relaxed text-gray-400">
                  {desc_zh}
                </p>
              </div>
            ),
          )}
        </div>
      </section>

      {/* Plan Preview */}
      <section className="container mx-auto px-6 py-16">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
          <h2 className="mb-2 text-2xl font-bold text-white">
            三档方案，按需选择
          </h2>
          <p className="mb-8 text-gray-500">
            Three plans — start free, upgrade anytime
          </p>
          <div className="mb-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            {[
              {
                name: "免费版 Free",
                price: "$0",
                color: "border-white/20 text-gray-300",
                features: "市场信号 · Market Signals",
              },
              {
                name: "专业版 Pro",
                price: "$29/mo",
                color: "border-cyan-500/50 text-cyan-300",
                features: "期权 · 暗池 · 内部交易 · AI 分析",
              },
              {
                name: "旗舰版 Premium",
                price: "$99/mo",
                color: "border-amber-500/30 text-amber-300",
                features: "Quant Lab · 回测 · 组合监控",
              },
            ].map(({ name, price, color, features }) => (
              <div
                key={name}
                className={`rounded-xl border px-6 py-4 text-center ${color} min-w-[180px]`}
              >
                <p className="text-base font-bold">{name}</p>
                <p className="mt-1 text-xl font-bold">{price}</p>
                <p className="mt-1 text-xs opacity-60">{features}</p>
              </div>
            ))}
          </div>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-500/20 px-6 py-3 font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/30"
          >
            查看完整功能对比 · Full Feature Comparison →
          </Link>
        </div>
      </section>

      {/* Trust */}
      <section className="container mx-auto px-6 py-12">
        <div className="flex flex-wrap items-center justify-center gap-8 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-gray-600" />
            Supabase RLS 数据隔离
          </div>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-gray-600" />
            SEC EDGAR · FINRA OTC 官方数据
          </div>
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-gray-600" />
            GPT-4o · Multi-Desk AI
          </div>
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-gray-600" />
            中英双语 · Bilingual
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-8">
        <div className="container mx-auto flex flex-col items-center justify-between gap-4 text-sm text-gray-600 sm:flex-row">
          <p>© 2026 Ventage · AI Institutional Market Intelligence</p>
          <div className="flex gap-6">
            <Link href="/pricing" className="hover:text-gray-400">
              定价 / Pricing
            </Link>
            <Link href="/login" className="hover:text-gray-400">
              登录 / Login
            </Link>
            <Link href="/signup" className="hover:text-gray-400">
              注册 / Sign Up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
