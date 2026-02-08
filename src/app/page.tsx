import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 flex items-center justify-center p-6">
      <div className="text-center max-w-4xl">
        <h1 className="text-6xl font-bold text-white mb-6 animate-fade-in">
          Ventage
        </h1>
        <p className="text-2xl text-gray-200 mb-4">
          AI-Powered FinTech Dashboard
        </p>
        <p className="text-lg text-gray-300 mb-12">
          实时市场信号 · 期权异动追踪 · 财报预测分析
        </p>

        <Link
          href="/dashboard"
          className="inline-block px-8 py-4 bg-white text-purple-900 rounded-lg font-semibold text-lg hover:bg-gray-100 transition-all hover:scale-105 shadow-xl"
        >
          进入Dashboard →
        </Link>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <div className="bg-white/10 backdrop-blur rounded-lg p-6">
            <div className="text-3xl mb-3">🤖</div>
            <h3 className="text-white font-semibold mb-2">AI 选股</h3>
            <p className="text-gray-300 text-sm">
              基于技术面、基本面和情绪的智能信号
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-lg p-6">
            <div className="text-3xl mb-3">📊</div>
            <h3 className="text-white font-semibold mb-2">期权异动</h3>
            <p className="text-gray-300 text-sm">
              追踪大额期权交易和Dark Pool订单
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-lg p-6">
            <div className="text-3xl mb-3">🔮</div>
            <h3 className="text-white font-semibold mb-2">财报预测</h3>
            <p className="text-gray-300 text-sm">
              AI预测EPS/营收 vs 分析师共识
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
