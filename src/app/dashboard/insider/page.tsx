"use client";

import { useInsiderTrades } from "@/lib/hooks/useInsiderTrades";
import { TrendingUp, TrendingDown } from "lucide-react";

export default function InsiderPage() {
    const { trades, loading, error } = useInsiderTrades(30);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-white text-2xl">加载中...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-red-500 text-xl">错误: {error.message}</div>
            </div>
        );
    }

    return (
        <div>
            <header className="border-b border-white/10 backdrop-blur-sm bg-white/5">
                <div className="container mx-auto px-6 py-6">
                    <div>
                        <h1 className="text-3xl font-bold text-white">内部交易</h1>
                        <p className="text-gray-400 mt-1">高管和内部人员交易记录</p>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-6 py-8">
                {trades.length === 0 ? (
                    <div className="text-center py-20">
                        <p className="text-gray-400 text-lg">暂无内部交易数据</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {trades.map((trade) => (
                            <div
                                key={trade.id}
                                className="bg-white/5 border border-white/10 rounded-lg p-6 hover:bg-white/10 transition-all"
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-4">
                                        <span className="text-2xl font-bold text-white">${trade.symbol}</span>
                                        <div className={`px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1 ${trade.trade_type === "BUY"
                                                ? "bg-green-500/20 text-green-300"
                                                : "bg-red-500/20 text-red-300"
                                            }`}>
                                            {trade.trade_type === "BUY" ? (
                                                <TrendingUp className="h-4 w-4" />
                                            ) : (
                                                <TrendingDown className="h-4 w-4" />
                                            )}
                                            {trade.trade_type}
                                        </div>
                                    </div>
                                    {trade.value && (
                                        <div className="text-white font-bold text-xl">
                                            ${trade.value.toLocaleString()}
                                        </div>
                                    )}
                                </div>

                                <div className="mb-3">
                                    <p className="text-white font-medium">{trade.insider_name}</p>
                                    {trade.insider_title && (
                                        <p className="text-gray-400 text-sm">{trade.insider_title}</p>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                                    <div>
                                        <p className="text-gray-500">股数</p>
                                        <p className="text-white font-medium">
                                            {trade.shares.toLocaleString()}
                                        </p>
                                    </div>
                                    {trade.price && (
                                        <div>
                                            <p className="text-gray-500">价格</p>
                                            <p className="text-white font-medium">${trade.price.toFixed(2)}</p>
                                        </div>
                                    )}
                                    <div>
                                        <p className="text-gray-500">申报日期</p>
                                        <p className="text-white font-medium">
                                            {new Date(trade.filing_date).toLocaleDateString("zh-CN")}
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-4 text-xs text-gray-500">
                                    {new Date(trade.created_at).toLocaleString("zh-CN")}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
