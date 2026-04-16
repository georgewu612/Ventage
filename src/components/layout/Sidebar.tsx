"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Bell,
  Brain,
  CandlestickChart,
  DollarSign,
  LogOut,
  Menu,
  MessageSquare,
  Newspaper,
  TrendingUp,
  User,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Locale } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/provider";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const { locale, setLocale, t } = useI18n();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserEmail(user?.email ?? null);
    });
  }, []);

  const handleLogout = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const navItems = [
    {
      name: t("nav.marketSignals"),
      href: "/dashboard",
      icon: TrendingUp,
    },
    {
      name: t("nav.options"),
      href: "/dashboard/options",
      icon: DollarSign,
    },
    {
      name: t("nav.insider"),
      href: "/dashboard/insider",
      icon: Users,
    },
    {
      name: t("nav.sentiment"),
      href: "/dashboard/sentiment",
      icon: MessageSquare,
    },
    {
      name: t("nav.technical"),
      href: "/dashboard/technical",
      icon: CandlestickChart,
    },
    {
      name: t("nav.reports"),
      href: "/dashboard/reports",
      icon: Brain,
    },
    {
      name: t("nav.news"),
      href: "/dashboard/news",
      icon: Newspaper,
    },
    {
      name: t("nav.alerts"),
      href: "/dashboard/alerts",
      icon: Bell,
    },
  ];

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 rounded-lg bg-white/10 p-2 text-white backdrop-blur lg:hidden"
      >
        {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      <aside
        className={`fixed top-0 left-0 z-40 h-full w-64 transform border-r border-white/10 bg-slate-900/95 backdrop-blur-xl transition-transform duration-300 ${isOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        <div className="border-b border-white/10 p-6">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-8 w-8 text-cyan-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Ventage</h1>
              <p className="text-xs text-gray-400">{t("app.tagline")}</p>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-gray-300">
            <span>{t("locale.label")}</span>
            <div className="inline-flex overflow-hidden rounded-md border border-white/10">
              <button
                onClick={() => setLocale("zh" as Locale)}
                className={`px-2 py-1 ${locale === "zh" ? "bg-cyan-500/30 text-white" : "bg-transparent"}`}
              >
                {t("locale.zh")}
              </button>
              <button
                onClick={() => setLocale("en" as Locale)}
                className={`px-2 py-1 ${locale === "en" ? "bg-cyan-500/30 text-white" : "bg-transparent"}`}
              >
                {t("locale.en")}
              </button>
            </div>
          </div>
        </div>

        <nav className="space-y-2 p-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-4 py-3 transition-all ${
                  isActive
                    ? "bg-cyan-500/20 font-medium text-cyan-200"
                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                } `}
              >
                <Icon className="h-5 w-5" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="absolute right-0 bottom-0 left-0 border-t border-white/10 p-4">
          {userEmail && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
              <User className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="truncate text-xs text-gray-300">
                {userEmail}
              </span>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-red-400"
          >
            <LogOut className="h-4 w-4" />
            {t("nav.logout") ?? "退出登录"}
          </button>
          <div className="mt-2 text-center text-xs text-gray-500">
            © 2026 Ventage
          </div>
        </div>
      </aside>

      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
