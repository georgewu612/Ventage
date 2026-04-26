"use client";

import { Lock } from "lucide-react";

import { type Plan, PLAN_LABELS } from "@/lib/features/gates";
import { useI18n } from "@/lib/i18n/provider";
import { useProfile } from "@/lib/hooks/useProfile";

interface FeatureGateProps {
  feature: string;
  /** Minimum plan label shown in the lock overlay */
  requiredPlan?: Plan;
  children: React.ReactNode;
  /** Show a full-card locked overlay instead of hiding children */
  overlay?: boolean;
}

/**
 * Wraps content that requires a specific plan.
 * - If user has access: renders children normally.
 * - If no access with overlay=false (default): renders a compact locked badge.
 * - If no access with overlay=true: renders children dimmed with a lock overlay.
 */
export function FeatureGate({
  feature,
  requiredPlan,
  children,
  overlay = false,
}: FeatureGateProps) {
  const { can, loading } = useProfile();
  const { t, locale } = useI18n();

  // While loading, render children (avoid layout flash)
  if (loading) return <>{children}</>;

  if (can(feature)) return <>{children}</>;

  const planKey = requiredPlan ?? "pro";
  const planLabel = PLAN_LABELS[planKey];
  const planName = locale === "zh" ? planLabel.zh : planLabel.en;

  if (overlay) {
    return (
      <div className="relative">
        <div className="pointer-events-none opacity-30 select-none">
          {children}
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-slate-900/80 backdrop-blur-sm">
          <Lock className="h-6 w-6 text-amber-400" />
          <p className="text-sm font-semibold text-white">
            {t("gate.requires")} {planName}
          </p>
          <a
            href="/pricing"
            className="rounded-lg bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/30"
          >
            {t("gate.unlock")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-500">
      <Lock className="h-4 w-4 text-amber-400/60" />
      <span>
        {t("gate.requires")} {planName} ·{" "}
      </span>
      <a
        href="/pricing"
        className="text-amber-400 underline-offset-2 hover:underline"
      >
        {t("gate.upgrade")}
      </a>
    </div>
  );
}
