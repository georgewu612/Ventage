"use client";

import { useCallback, useEffect, useState } from "react";

import { hasAccess } from "@/lib/features/gates";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export interface Profile {
  user_id: string;
  display_name: string | null;
  plan: "free" | "pro" | "premium";
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_expires_at: string | null;
  created_at: string;
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setProfile(null);
        return;
      }

      const { data, error: dbError } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (dbError) {
        // Profile may not exist yet (race with trigger) — treat as free
        if (dbError.code === "PGRST116") {
          setProfile({
            user_id: user.id,
            display_name: null,
            plan: "free",
            stripe_customer_id: null,
            stripe_subscription_id: null,
            plan_expires_at: null,
            created_at: new Date().toISOString(),
          });
        } else {
          throw new Error(dbError.message);
        }
      } else {
        setProfile(data as Profile);
      }
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const plan = profile?.plan ?? "free";

  return {
    profile,
    plan,
    loading,
    error,
    refetch: fetchProfile,
    /** Check if current user's plan grants access to a feature key */
    can: (feature: string) => hasAccess(plan, feature),
  };
}
