import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 p-6">
      <div className="max-w-4xl text-center">
        <h1 className="animate-fade-in mb-6 text-6xl font-bold text-white">
          Ventage
        </h1>
        <p className="mb-4 text-2xl text-gray-200">
          AI-Powered FinTech Dashboard
        </p>
        <p className="mb-12 text-lg text-gray-300">
          实时市场信号 · 期权异动追踪 · 财报预测分析
        </p>

        <Link
          href="/dashboard"
          className="inline-block rounded-lg bg-white px-8 py-4 text-lg font-semibold text-purple-900 shadow-xl transition-all hover:scale-105 hover:bg-gray-100"
        >
          进入Dashboard →
        </Link>

        <div className="mt-16 grid grid-cols-1 gap-6 text-left md:grid-cols-3">
          <div className="rounded-lg bg-white/10 p-6 backdrop-blur">
            <div className="mb-3 text-3xl">🤖</div>
            <h3 className="mb-2 font-semibold text-white">AI 选股</h3>
            <p className="text-sm text-gray-300">
              基于技术面、基本面和情绪的智能信号
            </p>
          </div>
          <div className="rounded-lg bg-white/10 p-6 backdrop-blur">
            <div className="mb-3 text-3xl">📊</div>
            <h3 className="mb-2 font-semibold text-white">期权异动</h3>
            <p className="text-sm text-gray-300">
              追踪大额期权交易和Dark Pool订单
            </p>
          </div>
          <div className="rounded-lg bg-white/10 p-6 backdrop-blur">
            <div className="mb-3 text-3xl">🔮</div>
            <h3 className="mb-2 font-semibold text-white">财报预测</h3>
            <p className="text-sm text-gray-300">
              AI预测EPS/营收 vs 分析师共识
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
