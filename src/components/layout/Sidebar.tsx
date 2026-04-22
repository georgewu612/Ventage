"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bell,
  Brain,
  CandlestickChart,
  ChevronDown,
  ChevronRight,
  CreditCard,
  DollarSign,
  FlaskConical,
  Layers,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  Newspaper,
  Radio,
  Settings,
  TrendingUp,
  User,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { PLAN_LABELS } from "@/lib/features/gates";
import { Locale } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/provider";
import { useProfile } from "@/lib/hooks/useProfile";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { ManageSubscriptionButton } from "@/components/billing/ManageSubscriptionButton";

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  feature?: string;
}

function NavLink({
  item,
  canAccess,
  onClick,
  isActive,
}: {
  item: NavItem;
  canAccess: boolean;
  onClick: () => void;
  isActive: boolean;
}) {
  const Icon = item.icon;
  const isLocked = item.feature ? !canAccess : false;

  return (
    <Link
      href={isLocked ? "/pricing" : item.href}
      onClick={onClick}
      title={isLocked ? "升级解锁此功能" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
        isActive && !isLocked
          ? "bg-cyan-500/20 font-medium text-cyan-200"
          : isLocked
            ? "cursor-pointer text-gray-600 hover:bg-white/5 hover:text-gray-400"
            : "text-gray-400 hover:bg-white/5 hover:text-white"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{item.name}</span>
      {isLocked && <Lock className="h-3 w-3 shrink-0 text-amber-500/60" />}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const { locale, setLocale, t } = useI18n();
  const { plan, can } = useProfile();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserEmail(user?.email ?? null);
    });
  }, []);

  const DATA_SOURCE_PATHS = [
    "/dashboard/options",
    "/dashboard/insider",
    "/dashboard/sentiment",
    "/dashboard/darkpool",
    "/dashboard/technical",
    "/dashboard/news",
  ];
  const isOnDataSource = DATA_SOURCE_PATHS.some((p) => pathname.startsWith(p));
  // Auto-expand when on a data source page; user can also toggle manually
  const dataSourceOpen = isOnDataSource || userOpen;

  const handleLogout = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const close = () => setIsOpen(false);

  const mainNav: NavItem[] = [
    { name: "市场雷达", href: "/dashboard", icon: Radio },
    {
      name: "单票工作台",
      href: "/dashboard/stocks/NVDA",
      icon: TrendingUp,
      feature: "stock_workbench",
    },
    {
      name: "Quant Lab",
      href: "/dashboard/quant-lab",
      icon: FlaskConical,
      feature: "quant_lab",
    },
    {
      name: "组合监控",
      href: "/dashboard/portfolio",
      icon: Wallet,
      feature: "portfolio",
    },
    {
      name: "执行层",
      href: "/dashboard/execution",
      icon: Activity,
      feature: "execution",
    },
  ];

  const dataSourceNav: NavItem[] = [
    {
      name: t("nav.options"),
      href: "/dashboard/options",
      icon: DollarSign,
      feature: "options_flow",
    },
    {
      name: t("nav.insider"),
      href: "/dashboard/insider",
      icon: Users,
      feature: "insider_trades",
    },
    {
      name: t("nav.darkpool"),
      href: "/dashboard/darkpool",
      icon: Layers,
      feature: "dark_pool",
    },
    {
      name: t("nav.sentiment"),
      href: "/dashboard/sentiment",
      icon: MessageSquare,
      feature: "sentiment",
    },
    {
      name: t("nav.technical"),
      href: "/dashboard/technical",
      icon: CandlestickChart,
      feature: "technical",
    },
    { name: t("nav.news"), href: "/dashboard/news", icon: Newspaper },
  ];

  const toolsNav: NavItem[] = [
    {
      name: t("nav.reports"),
      href: "/dashboard/reports",
      icon: Brain,
      feature: "ai_reports",
    },
    {
      name: t("nav.multiAgent"),
      href: "/dashboard/multi-agent",
      icon: Users,
      feature: "multi_agent",
    },
    {
      name: t("nav.alerts"),
      href: "/dashboard/alerts",
      icon: Bell,
      feature: "alerts",
    },
    {
      name: "系统管理",
      href: "/dashboard/admin",
      icon: Settings,
      feature: "admin",
    },
  ];

  const planInfo =
    PLAN_LABELS[plan as keyof typeof PLAN_LABELS] ?? PLAN_LABELS.free;

  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(href);

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 rounded-lg bg-white/10 p-2 text-white backdrop-blur lg:hidden"
      >
        {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      <aside
        className={`fixed top-0 left-0 z-40 flex h-full w-64 transform flex-col border-r border-white/10 bg-slate-900/95 backdrop-blur-xl transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
      >
        {/* Logo */}
        <div className="border-b border-white/10 p-5">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-7 w-7 text-cyan-400" />
            <div>
              <h1 className="text-lg font-bold text-white">Ventage</h1>
              <p className="text-[10px] text-gray-500">AI Quant Research</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
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

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <p className="mb-1 px-3 text-[10px] font-semibold tracking-wider text-gray-600 uppercase">
            主功能
          </p>
          {mainNav.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              canAccess={item.feature ? can(item.feature) : true}
              onClick={close}
              isActive={isActive(item.href)}
            />
          ))}

          <div className="mt-3">
            <button
              onClick={() => setUserOpen((v) => !v)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[10px] font-semibold tracking-wider text-gray-600 uppercase transition-colors hover:text-gray-400"
            >
              {dataSourceOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              数据源
            </button>
            {dataSourceOpen && (
              <div className="mt-1 space-y-0.5">
                {dataSourceNav.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    canAccess={item.feature ? can(item.feature) : true}
                    onClick={close}
                    isActive={isActive(item.href)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="mt-3">
            <p className="mb-1 px-3 text-[10px] font-semibold tracking-wider text-gray-600 uppercase">
              工具
            </p>
            {toolsNav.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                canAccess={item.feature ? can(item.feature) : true}
                onClick={close}
                isActive={isActive(item.href)}
              />
            ))}
            <Link
              href="/pricing"
              onClick={close}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
                pathname === "/pricing"
                  ? "bg-cyan-500/20 font-medium text-cyan-200"
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <CreditCard className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">定价方案</span>
            </Link>
          </div>
        </nav>

        {/* Footer */}
        <div className="space-y-2 border-t border-white/10 p-4">
          <div className="flex items-center justify-between">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${planInfo.color}`}
            >
              {planInfo.zh}
            </span>
            <Link
              href="/pricing"
              onClick={close}
              className="flex items-center gap-1 text-xs text-amber-400 hover:underline"
            >
              <CreditCard className="h-3 w-3" />
              定价方案
            </Link>
          </div>
          {plan !== "free" && (
            <div onClick={close}>
              <ManageSubscriptionButton />
            </div>
          )}
          {userEmail && (
            <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
              <User className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <span className="truncate text-xs text-gray-300">
                {userEmail}
              </span>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs text-gray-500 transition-colors hover:bg-white/5 hover:text-red-400"
          >
            <LogOut className="h-4 w-4" />
            {t("nav.logout")}
          </button>
        </div>
      </aside>

      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={close}
        />
      )}
    </>
  );
}
