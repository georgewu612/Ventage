"use client";

import Link from "next/link";
import { FlaskConical, Lock } from "lucide-react";

import { useProfile } from "@/lib/hooks/useProfile";

export default function QuantLabPage() {
  const { can, loading } = useProfile();
  const hasAccess = !loading && can("quant_lab");

  return (
    <div>
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center gap-3">
            <FlaskConical className="h-7 w-7 text-purple-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Quant Lab</h1>
              <p className="mt-1 text-gray-400">
                因子研究 · 策略回测 · 参数优化 · Walk-forward 分析
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
              Quant Lab 包含 Alpha 因子库、vectorbt 策略回测引擎、参数优化与
              Walk-forward 验证，需升级到旗舰版解锁。
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
              <div className="rounded-full bg-purple-500/10 p-4">
                <FlaskConical className="h-10 w-10 text-purple-400" />
              </div>
            </div>
            <h2 className="mb-3 text-2xl font-bold text-white">
              Quant Lab — 开发中
            </h2>
            <p className="text-gray-400">
              量化研究模块正在开发中，即将上线。届时将支持因子研究、策略回测与参数优化。
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
