"use client";

import { useMarketSentiment } from "@/lib/hooks/useMarketSentiment";
import { Heart, Frown, Meh } from "lucide-react";

export default function SentimentPage() {
    const { sentiments, loading, error } = useMarketSentiment(30);

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

    const getSentimentIcon = (score: number | null) => {
        if (!score) return <Meh className="h-5 w-5 text-gray-400" />;
        if (score > 0.3) return <Heart className="h-5 w-5 text-green-400" />;
        if (score < -0.3) return <Frown className="h-5 w-5 text-red-400" />;
        return <Meh className="h-5 w-5 text-yellow-400" />;
    };

    const getSentimentColor = (score: number | null) => {
        if (!score) return "bg-gray-500/20 text-gray-300";
        if (score > 0.3) return "bg-green-500/20 text-green-300";
        if (score < -0.3) return "bg-red-500/20 text-red-300";
        return "bg-yellow-500/20 text-yellow-300";
    };

    return (
        <div>
            <header className="border-b border-white/10 backdrop-blur-sm bg-white/5">
                <div className="container mx-auto px-6 py-6">
                    <div>
                        <h1 className="text-3xl font-bold text-white">市场情绪</h1>
                        <p className="text-gray-400 mt-1">社交媒体与新闻情绪分析</p>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-6 py-8">
                {sentiments.length === 0 ? (
                    <div className="text-center py-20">
                        <p className="text-gray-400 text-lg">暂无情绪数据</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {sentiments.map((sentiment) => (
                            <div
                                key={sentiment.id}
                                className="bg-white/5 border border-white/10 rounded-lg p-6 hover:bg-white/10 transition-all"
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <span className="text-2xl font-bold text-white">${sentiment.symbol}</span>
                                        {getSentimentIcon(sentiment.sentiment_score)}
                                    </div>
                                    <div className="px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300">
                                        {sentiment.source}
                                    </div>
                                </div>

                                {sentiment.sentiment_score !== null && (
                                    <div className="mb-4">
                                        <div className={`inline-block px-4 py-2 rounded-lg ${getSentimentColor(sentiment.sentiment_score)}`}>
                                            <span className="font-bold">
                                                情绪分数: {(sentiment.sentiment_score * 100).toFixed(0)}%
                                            </span>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                                    {sentiment.magnitude !== null && (
                                        <div>
                                            <p className="text-gray-500">强度</p>
                                            <p className="text-white font-medium">
                                                {(sentiment.magnitude * 100).toFixed(0)}%
                                            </p>
                                        </div>
                                    )}
                                    {sentiment.volume !== null && (
                                        <div>
                                            <p className="text-gray-500">讨论量</p>
                                            <p className="text-white font-medium">
                                                {sentiment.volume.toLocaleString()}
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {sentiment.keywords && Array.isArray(sentiment.keywords) && sentiment.keywords.length > 0 && (
                                    <div className="mb-3">
                                        <p className="text-gray-500 text-xs mb-2">热词</p>
                                        <div className="flex flex-wrap gap-2">
                                            {sentiment.keywords.slice(0, 5).map((keyword: string, idx: number) => (
                                                <span
                                                    key={idx}
                                                    className="px-2 py-1 bg-white/10 rounded text-xs text-gray-300"
                                                >
                                                    {keyword}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="mt-4 text-xs text-gray-500">
                                    {sentiment.analysis_window} · {new Date(sentiment.created_at).toLocaleString("zh-CN")}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
