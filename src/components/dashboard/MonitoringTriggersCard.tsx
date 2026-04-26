"use client";

import { AlertTriangle, Eye } from "lucide-react";

import { useI18n } from "@/lib/i18n/provider";

interface Props {
  conditions: string[] | undefined;
  conditionsEn?: string[] | undefined;
  loading?: boolean;
}

export function MonitoringTriggersCard({
  conditions,
  conditionsEn,
  loading = false,
}: Props) {
  const { locale } = useI18n();

  const items =
    locale === "zh"
      ? conditions
      : conditionsEn && conditionsEn.length > 0
        ? conditionsEn
        : conditions;

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Eye className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">
            {locale === "zh" ? "持续监控触发点" : "Monitoring Triggers"}
          </span>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded-lg bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Eye className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">
            {locale === "zh" ? "持续监控触发点" : "Monitoring Triggers"}
          </span>
        </div>
        <p className="text-sm text-gray-500">
          {locale === "zh"
            ? "暂无监控条件 — 请先运行 Desk 分析"
            : "No triggers yet — run Desk analysis first"}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">
            {locale === "zh" ? "持续监控触发点" : "Monitoring Triggers"}
          </span>
        </div>
        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
          {locale === "zh" ? "持续关注" : "Watch"}
        </span>
      </div>

      {/* Trigger list */}
      <div className="space-y-2">
        {items.map((condition, i) => (
          <div
            key={i}
            className="flex items-start gap-3 rounded-lg border border-amber-500/10 bg-black/20 px-3 py-2.5"
          >
            {/* Status dot */}
            <div className="mt-0.5 flex-shrink-0">
              <div className="h-2 w-2 rounded-full bg-amber-400 ring-2 ring-amber-400/30" />
            </div>

            {/* Condition text */}
            <span className="flex-1 text-sm text-gray-300">{condition}</span>

            {/* Watch badge */}
            <span className="flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-400/70 ring-1 ring-amber-400/20">
              {locale === "zh" ? "待观察" : "Watching"}
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <p className="mt-3 flex items-center gap-1.5 text-[10px] text-gray-600">
        <AlertTriangle className="h-3 w-3" />
        {locale === "zh"
          ? "上述条件触发时建议重新评估持仓"
          : "Re-evaluate your position if any trigger above fires"}
      </p>
    </div>
  );
}
