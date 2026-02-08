"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface OptionsFlow {
    id: string;
    symbol: string;
    option_type: "CALL" | "PUT";
    strike: number;
    expiration: string;
    premium: number;
    volume: number;
    open_interest: number | null;
    implied_volatility: number | null;
    unusual_score: number | null;
    trade_type: string | null;
    sentiment: string | null;
    created_at: string;
}

export function useOptionsFlow(limit: number = 50) {
    const [options, setOptions] = useState<OptionsFlow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const supabase = createSupabaseBrowserClient();

    useEffect(() => {
        fetchOptions();

        const channel = supabase
            .channel("options_flow_changes")
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "options_flow",
                },
                (payload) => {
                    setOptions((prev) => [payload.new as OptionsFlow, ...prev].slice(0, limit));
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [limit]);

    async function fetchOptions() {
        try {
            setLoading(true);
            const { data, error: fetchError } = await supabase
                .from("options_flow")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(limit);

            if (fetchError) throw fetchError;
            setOptions(data || []);
        } catch (err) {
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }

    return { options, loading, error, refetch: fetchOptions };
}
