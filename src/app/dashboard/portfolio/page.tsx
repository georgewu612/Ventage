"use client";

import Link from "next/link";
import { Lock, Wallet } from "lucide-react";

import { useProfile } from "@/lib/hooks/useProfile";

export default function PortfolioPage() {
  const { can, loading } = useProfile();
  const hasAccess = !loading && can("portfolio");

  return (
    <div>
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center gap-3">
            <Wallet className="h-7 w-7 text-cyan-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">组合监控</h1>
              <p className="mt-1 text-gray-400">
                持仓管理 · 收益分析 · 风险敞口 · 行业分布
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-16">
        {!hasAccess ? (
          <div className="mx-auto max-w-lg text-center">
            <div className="mb-6 flex justify-center">
              <div className="rounded-full bg-amber-500/10 p-4">
                <Lock className="h-10 w-10 text-amber-400" />
              </div>
            </div>
            <h2 className="mb-3 text-2xl font-bold text-white">
              需要旗舰版 (Premium)
            </h2>
            <p className="mb-8 text-gray-400">
              组合监控支持持仓导入（TD Ameritrade / IBKR CSV）、收益曲线、
              风险敞口分析与行业分布，需升级到旗舰版解锁。
            </p>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500/20 px-6 py-3 font-semibold text-amber-300 transition-colors hover:bg-amber-500/30"
            >
              查看定价 →
            </Link>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-6 flex justify-center">
              <div className="rounded-full bg-cyan-500/10 p-4">
                <Wallet className="h-10 w-10 text-cyan-400" />
              </div>
            </div>
            <h2 className="mb-3 text-2xl font-bold text-white">
              组合监控 — 开发中
            </h2>
            <p className="text-gray-400">
              组合监控模块正在开发中，即将上线。届时将支持持仓导入、收益分析与风险管理。
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
