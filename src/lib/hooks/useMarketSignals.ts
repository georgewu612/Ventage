"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

interface MarketSignal {
    id: string;
    symbol: string;
    signal_type: string;
    direction: "bullish" | "bearish" | "neutral";
    confidence: number;
    analysis: string | null;
    factors: any;
    valid_until: string | null;
    created_at: string;
}

export function useMarketSignals(limit: number = 50) {
    const [signals, setSignals] = useState<MarketSignal[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const supabase = createBrowserClient();

    useEffect(() => {
        // Initial fetch
        fetchSignals();

        // Subscribe to realtime updates
        const channel = supabase
            .channel("market_signals_changes")
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "market_signals",
                },
                (payload) => {
                    setSignals((prev) => [payload.new as MarketSignal, ...prev].slice(0, limit));
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [limit]);

    async function fetchSignals() {
        try {
            setLoading(true);
            const { data, error: fetchError } = await supabase
                .from("market_signals")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(limit);

            if (fetchError) throw fetchError;
            setSignals(data || []);
        } catch (err) {
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }

    return { signals, loading, error, refetch: fetchSignals };
}
