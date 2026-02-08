"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface InsiderTrade {
    id: string;
    symbol: string;
    insider_name: string;
    insider_title: string | null;
    relationship: string | null;
    trade_type: "BUY" | "SELL";
    shares: number;
    price: number | null;
    value: number | null;
    shares_owned_after: number | null;
    filing_date: string;
    transaction_date: string | null;
    sec_form: string | null;
    footnotes: string | null;
    created_at: string;
}

export function useInsiderTrades(limit: number = 50) {
    const [trades, setTrades] = useState<InsiderTrade[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const supabase = createSupabaseBrowserClient();

    useEffect(() => {
        fetchTrades();

        const channel = supabase
            .channel("insider_trades_changes")
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "insider_trades",
                },
                (payload) => {
                    setTrades((prev) => [payload.new as InsiderTrade, ...prev].slice(0, limit));
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [limit]);

    async function fetchTrades() {
        try {
            setLoading(true);
            const { data, error: fetchError } = await supabase
                .from("insider_trades")
                .select("*")
                .order("filing_date", { ascending: false })
                .limit(limit);

            if (fetchError) throw fetchError;
            setTrades(data || []);
        } catch (err) {
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }

    return { trades, loading, error, refetch: fetchTrades };
}
