import Link from "next/link";
import {
  BarChart3,
  Brain,
  DollarSign,
  FlaskConical,
  Layers,
  Shield,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

const FEATURES = [
  {
    icon: TrendingUp,
    title: "AI 市场信号",
    desc: "技术面、基本面、情绪、期权异动多维度信号，实时评分与告警。",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
  },
  {
    icon: DollarSign,
    title: "期权异动监控",
    desc: "异常大单扫描、Call/Put 比率、行权价分布，捕捉机构动向。",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  {
    icon: Layers,
    title: "暗池大宗追踪",
    desc: "FINRA OTC 场外大单实时监控，鲸鱼资金动向一目了然。",
    color: "text-purple-400",
    bg: "bg-purple-500/10",
  },
  {
    icon: Users,
    title: "内部交易雷达",
    desc: "SEC Form 4 实时解析，高管买卖、RSU 授予与税款代扣智能区分。",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
  },
  {
    icon: Brain,
    title: "7-Agent AI 分析",
    desc: "基本面、情绪、技术、新闻、多空辩论、风控 7 个专业 Agent 协作生成交易决策。",
    color: "text-pink-400",
    bg: "bg-pink-500/10",
  },
  {
    icon: FlaskConical,
    title: "Quant Lab（即将上线）",
    desc: "Alpha 因子研究、vectorbt 回测引擎、Walk-forward 验证与参数优化。",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
];

const STATS = [
  { value: "7", label: "专业 AI Agent" },
  { value: "5+", label: "数据源" },
  { value: "实时", label: "信号更新" },
  { value: "全中英", label: "双语支持" },
];

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
              定价
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
            >
              登录
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-400"
            >
              免费开始
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="container mx-auto px-6 py-24 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1.5 text-sm text-cyan-300">
          <Zap className="h-3.5 w-3.5" />
          AI 驱动的量化研究平台
        </div>
        <h1 className="mx-auto mb-6 max-w-3xl text-5xl leading-tight font-bold text-white">
          专业级 AI 股票分析
          <br />
          <span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
            量化研究 · 策略回测
          </span>
        </h1>
        <p className="mx-auto mb-10 max-w-2xl text-lg text-gray-400">
          Ventage 聚合期权异动、暗池大单、内部交易、市场情绪与 AI 多智能体分析，
          为主动交易者和量化研究者提供专业级决策支持。
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
          {STATS.map(({ value, label }) => (
            <div key={label}>
              <p className="text-3xl font-bold text-white">{value}</p>
              <p className="mt-1 text-sm text-gray-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features Grid */}
      <section className="container mx-auto px-6 py-16">
        <h2 className="mb-12 text-center text-3xl font-bold text-white">
          覆盖每一个交易决策维度
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc, color, bg }) => (
            <div
              key={title}
              className="rounded-2xl border border-white/10 bg-white/5 p-6 transition-all hover:border-white/20 hover:bg-white/[0.08]"
            >
              <div className={`mb-4 inline-flex rounded-xl ${bg} p-3`}>
                <Icon className={`h-6 w-6 ${color}`} />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-white">{title}</h3>
              <p className="text-sm leading-relaxed text-gray-400">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Plan Preview */}
      <section className="container mx-auto px-6 py-16">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
          <h2 className="mb-4 text-2xl font-bold text-white">
            三档方案，按需选择
          </h2>
          <p className="mb-8 text-gray-400">
            从免费版开始体验，随时升级解锁更多功能
          </p>
          <div className="mb-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            {[
              {
                name: "免费版",
                price: "$0",
                color: "border-white/20 text-gray-300",
              },
              {
                name: "专业版",
                price: "$29/月",
                color: "border-cyan-500/50 text-cyan-300",
              },
              {
                name: "旗舰版",
                price: "$99/月",
                color: "border-amber-500/30 text-amber-300",
              },
            ].map(({ name, price, color }) => (
              <div
                key={name}
                className={`rounded-xl border px-8 py-4 text-center ${color}`}
              >
                <p className="text-lg font-bold">{name}</p>
                <p className="text-sm opacity-70">{price}</p>
              </div>
            ))}
          </div>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-500/20 px-6 py-3 font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/30"
          >
            查看完整功能对比 →
          </Link>
        </div>
      </section>

      {/* Trust & Security */}
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
            GPT-4o 驱动分析
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-8">
        <div className="container mx-auto flex flex-col items-center justify-between gap-4 text-sm text-gray-600 sm:flex-row">
          <p>© 2026 Ventage · AI Quant Research Platform</p>
          <div className="flex gap-6">
            <Link href="/pricing" className="hover:text-gray-400">
              定价
            </Link>
            <Link href="/login" className="hover:text-gray-400">
              登录
            </Link>
            <Link href="/signup" className="hover:text-gray-400">
              注册
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
