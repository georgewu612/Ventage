"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Signal {
    id: string;
    symbol: string;
    direction: "bullish" | "bearish" | "neutral";
    confidence: number;
    signal_type: string;
    analysis?: string;
    created_at: string;
}

export function SignalCard({ signal }: { signal: Signal }) {
    const directionConfig = {
        bullish: {
            icon: TrendingUp,
            color: "text-green-500",
            bg: "bg-green-500/10",
            border: "border-green-500/20",
        },
        bearish: {
            icon: TrendingDown,
            color: "text-red-500",
            bg: "bg-red-500/10",
            border: "border-red-500/20",
        },
        neutral: {
            icon: Minus,
            color: "text-yellow-500",
            bg: "bg-yellow-500/10",
            border: "border-yellow-500/20",
        },
    };

    const config = directionConfig[signal.direction];
    const Icon = config.icon;
    const confidencePercent = Math.round(signal.confidence * 100);

    return (
        <div
            className={`rounded-lg border ${config.border} ${config.bg} p-6 transition-all hover:shadow-lg`}
        >
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold">${signal.symbol}</span>
                    <Icon className={`h-5 w-5 ${config.color}`} />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium px-3 py-1 rounded-full bg-white/50 dark:bg-black/50">
                        {confidencePercent}% 置信度
                    </span>
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <span className="font-medium">类型:</span>
                    <span className="capitalize">{signal.signal_type}</span>
                </div>

                {signal.analysis && (
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-3">
                        {signal.analysis}
                    </p>
                )}

                <div className="text-xs text-gray-500 mt-4">
                    {new Date(signal.created_at).toLocaleString("zh-CN")}
                </div>
            </div>
        </div>
    );
}
