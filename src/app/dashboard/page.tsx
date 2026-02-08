"use client";

import { useMarketSignals } from "@/lib/hooks/useMarketSignals";
import { SignalCard } from "@/components/dashboard/SignalCard";

export default function DashboardPage() {
    const { signals, loading, error } = useMarketSignals(20);

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
                <div className="text-white text-2xl">加载中...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
                <div className="text-red-500 text-xl">错误: {error.message}</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
            {/* Header */}
            <header className="border-b border-white/10 backdrop-blur-sm bg-white/5">
                <div className="container mx-auto px-6 py-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-white">Ventage</h1>
                            <p className="text-gray-400 mt-1">AI-Powered FinTech Dashboard</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="px-4 py-2 rounded-lg bg-white/10 backdrop-blur">
                                <span className="text-white font-medium">{signals.length} 信号</span>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="container mx-auto px-6 py-8">
                <div className="mb-8">
                    <h2 className="text-2xl font-bold text-white mb-2">📊 市场信号</h2>
                    <p className="text-gray-400">AI 实时分析的交易信号</p>
                </div>

                {signals.length === 0 ? (
                    <div className="text-center py-20">
                        <p className="text-gray-400 text-lg">暂无信号数据</p>
                        <p className="text-gray-500 text-sm mt-2">
                            运行 <code className="px-2 py-1 bg-white/10 rounded">python -m python.scripts.generate_mock_data</code> 生成测试数据
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {signals.map((signal) => (
                            <SignalCard key={signal.id} signal={signal} />
                        ))}
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="border-t border-white/10 mt-20 py-8 backdrop-blur-sm bg-white/5">
                <div className="container mx-auto px-6 text-center text-gray-500">
                    <p>Ventage © 2026 - AI Fintech Dashboard</p>
                </div>
            </footer>
        </div>
    );
}
