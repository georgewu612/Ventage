"use client";

import { useOptionsFlow } from "@/lib/hooks/useOptionsFlow";
import { ArrowDown, ArrowUp } from "lucide-react";

export default function OptionsPage() {
    const { options, loading, error } = useOptionsFlow(30);

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
                        <h1 className="text-3xl font-bold text-white">期权异动</h1>
                        <p className="text-gray-400 mt-1">大额期权交易与异常活动</p>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-6 py-8">
                {options.length === 0 ? (
                    <div className="text-center py-20">
                        <p className="text-gray-400 text-lg">暂无期权数据</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {options.map((option) => (
                            <div
                                key={option.id}
                                className="bg-white/5 border border-white/10 rounded-lg p-6 hover:bg-white/10 transition-all"
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-4">
                                        <span className="text-2xl font-bold text-white">${option.symbol}</span>
                                        <div className={`px-3 py-1 rounded-full text-sm font-medium ${option.option_type === "CALL"
                                                ? "bg-green-500/20 text-green-300"
                                                : "bg-red-500/20 text-red-300"
                                            }`}>
                                            {option.option_type}
                                            {option.option_type === "CALL" ? (
                                                <ArrowUp className="inline h-4 w-4 ml-1" />
                                            ) : (
                                                <ArrowDown className="inline h-4 w-4 ml-1" />
                                            )}
                                        </div>
                                    </div>
                                    {option.unusual_score && (
                                        <div className="text-yellow-400 font-bold">
                                            异常分数: {option.unusual_score.toFixed(2)}
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                    <div>
                                        <p className="text-gray-500">行权价</p>
                                        <p className="text-white font-medium">${option.strike}</p>
                                    </div>
                                    <div>
                                        <p className="text-gray-500">到期日</p>
                                        <p className="text-white font-medium">
                                            {new Date(option.expiration).toLocaleDateString("zh-CN")}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-gray-500">权利金</p>
                                        <p className="text-white font-medium">
                                            ${option.premium.toLocaleString()}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-gray-500">成交量</p>
                                        <p className="text-white font-medium">
                                            {option.volume.toLocaleString()}
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-4 text-xs text-gray-500">
                                    {new Date(option.created_at).toLocaleString("zh-CN")}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
