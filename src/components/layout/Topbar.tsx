"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Bell, Search } from "lucide-react";

import { PLAN_LABELS } from "@/lib/features/gates";
import { useProfile } from "@/lib/hooks/useProfile";
import { useI18n } from "@/lib/i18n/provider";

// ── Page title resolver ────────────────────────────────────────────────────────

type TitleKey =
  | "page.marketRadar"
  | "page.quantLab"
  | "page.strategies"
  | "page.portfolio"
  | "page.execution"
  | "page.options"
  | "page.insider"
  | "page.darkpool"
  | "page.sentiment"
  | "page.technical"
  | "page.news"
  | "page.reports"
  | "page.multiAgent"
  | "page.alerts"
  | "page.admin"
  | "page.pricing"
  | "page.stockWorkbench"
  | "page.strategyDetail";

const STATIC_TITLE_KEYS: Record<string, TitleKey> = {
  "/dashboard": "page.marketRadar",
  "/dashboard/quant-lab": "page.quantLab",
  "/dashboard/strategies": "page.strategies",
  "/dashboard/portfolio": "page.portfolio",
  "/dashboard/execution": "page.execution",
  "/dashboard/options": "page.options",
  "/dashboard/insider": "page.insider",
  "/dashboard/darkpool": "page.darkpool",
  "/dashboard/sentiment": "page.sentiment",
  "/dashboard/technical": "page.technical",
  "/dashboard/news": "page.news",
  "/dashboard/reports": "page.reports",
  "/dashboard/multi-agent": "page.multiAgent",
  "/dashboard/alerts": "page.alerts",
  "/dashboard/admin": "page.admin",
  "/pricing": "page.pricing",
};

// ── Component ──────────────────────────────────────────────────────────────────

export function Topbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { plan } = useProfile();
  const { t, locale } = useI18n();
  const [search, setSearch] = useState("");

  const planInfo =
    PLAN_LABELS[plan as keyof typeof PLAN_LABELS] ?? PLAN_LABELS.free;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = search.trim().toUpperCase();
    if (sym) {
      router.push(`/dashboard/stocks/${sym}`);
      setSearch("");
    }
  };

  const resolveTitle = (): string => {
    const key = STATIC_TITLE_KEYS[pathname];
    if (key) return t(key);
    if (pathname.startsWith("/dashboard/stocks/")) {
      const sym = pathname.split("/dashboard/stocks/")[1]?.toUpperCase();
      return sym
        ? `$${sym} ${t("page.stockWorkbench")}`
        : t("page.stockWorkbench");
    }
    if (pathname.startsWith("/dashboard/strategies/")) {
      return t("page.strategyDetail");
    }
    // Prefix match fallback
    for (const [path, titleKey] of Object.entries(STATIC_TITLE_KEYS)) {
      if (pathname.startsWith(path + "/")) return t(titleKey);
    }
    return "Ventage";
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-white/10 bg-slate-900/95 px-4 backdrop-blur-xl lg:px-6">
      {/* Page title — hidden on mobile (sidebar toggle takes the space) */}
      <h2 className="hidden min-w-0 shrink-0 text-sm font-semibold text-white lg:block">
        {resolveTitle()}
      </h2>

      {/* Symbol quick-search */}
      <form onSubmit={handleSearch} className="ml-0 w-full max-w-xs lg:ml-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value.toUpperCase())}
            placeholder={t("topbar.searchPlaceholder")}
            className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pr-3 pl-9 text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none"
          />
        </div>
      </form>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-2">
        <button
          className="rounded-lg border border-white/10 p-1.5 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
          title={t("topbar.notifications")}
        >
          <Bell className="h-4 w-4" />
        </button>
        <span
          className={`hidden rounded-full px-2.5 py-1 text-xs font-semibold sm:inline-flex ${planInfo.color}`}
        >
          {locale === "zh" ? planInfo.zh : planInfo.en}
        </span>
      </div>
    </header>
  );
}
