"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface MarketSentiment {
    id: string;
    symbol: string;
    source: string;
    sentiment_score: number | null;
    magnitude: number | null;
    volume: number | null;
    keywords: any;
    sample_posts: any;
    analysis_window: string | null;
    created_at: string;
}

export function useMarketSentiment(limit: number = 50) {
    const [sentiments, setSentiments] = useState<MarketSentiment[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const supabase = createSupabaseBrowserClient();

    useEffect(() => {
        fetchSentiments();

        const channel = supabase
            .channel("market_sentiment_changes")
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "market_sentiment",
                },
                (payload) => {
                    setSentiments((prev) => [payload.new as MarketSentiment, ...prev].slice(0, limit));
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [limit]);

    async function fetchSentiments() {
        try {
            setLoading(true);
            const { data, error: fetchError } = await supabase
                .from("market_sentiment")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(limit);

            if (fetchError) throw fetchError;
            setSentiments(data || []);
        } catch (err) {
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }

    return { sentiments, loading, error, refetch: fetchSentiments };
}
