"use client";

import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { useTheme } from "@/lib/theme/provider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { theme } = useTheme();

  return (
    <div
      className={
        theme === "light"
          ? "min-h-screen bg-gradient-to-br from-slate-100 via-blue-50/30 to-slate-100 transition-colors duration-300"
          : "min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 transition-colors duration-300"
      }
    >
      <Sidebar />
      <div className="lg:ml-64">
        <Topbar />
        {children}
      </div>
    </div>
  );
}
