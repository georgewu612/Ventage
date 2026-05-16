"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { useI18n } from "@/lib/i18n/provider";
import type { ManualEntry } from "@/content/manual/manifest";

import { HelpSearch } from "./HelpSearch";

interface Props {
  entries: ManualEntry[];
  totalPages: number;
}

const SECTION_LABELS: Record<string, { zh: string; en: string }> = {
  overview: { zh: "00 总览", en: "00 Overview" },
  L1: { zh: "L1 入口", en: "L1 Entry" },
  L2: { zh: "L2 核心", en: "L2 Core" },
  L3: { zh: "L3 策略研究", en: "L3 Strategy Research" },
  L4: { zh: "L4 数据情报", en: "L4 Data Intelligence" },
  L5: { zh: "L5 运营管理", en: "L5 Operations" },
};

const SECTION_ORDER: (keyof typeof SECTION_LABELS)[] = [
  "overview",
  "L1",
  "L2",
  "L3",
  "L4",
  "L5",
];

function sectionFor(slug: string): keyof typeof SECTION_LABELS {
  if (slug.startsWith("00")) return "overview";
  if (slug.startsWith("L1")) return "L1";
  if (slug.startsWith("L2")) return "L2";
  if (slug.startsWith("L3")) return "L3";
  if (slug.startsWith("L4")) return "L4";
  if (slug.startsWith("L5")) return "L5";
  return "overview";
}

export function HelpIndex({ entries, totalPages }: Props) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const groups = SECTION_ORDER.reduce(
    (acc, key) => {
      acc[key] = entries.filter((e) => sectionFor(e.slug) === key);
      return acc;
    },
    {} as Record<string, ManualEntry[]>,
  );

  return (
    <>
      <p className="mb-6 text-slate-400">
        {isZh
          ? "Ventage 全站使用教材。按模块组织 · 白话讲解 · 可搜索。"
          : "Ventage user manual — organized by module, plain language, searchable."}
      </p>

      <HelpSearch entries={entries} />

      <div className="mt-8 space-y-8">
        {SECTION_ORDER.map((key) => {
          const items = groups[key];
          if (!items.length) return null;
          const sectionLabel = SECTION_LABELS[key];
          return (
            <section key={key}>
              <h2 className="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">
                {isZh ? sectionLabel.zh : sectionLabel.en}
              </h2>
              <div className="grid gap-2 md:grid-cols-2">
                {items.map((e) => {
                  const title = isZh ? e.titleZh : e.titleEn;
                  const excerpt = isZh ? e.excerptZh : e.excerptEn;
                  const noEnglish = !isZh && !e.bodyEn;
                  return (
                    <Link
                      key={e.slug}
                      href={`/dashboard/help/${e.slug}`}
                      className="group block rounded-lg border border-slate-800 bg-slate-900/40 p-4 transition hover:border-cyan-500/40 hover:bg-slate-900/70"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-white group-hover:text-cyan-300">
                          {title}
                        </h3>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-cyan-400" />
                      </div>
                      {excerpt && (
                        <p className="mt-2 line-clamp-2 text-sm text-slate-400">
                          {excerpt}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <code className="text-xs text-slate-500">
                          /dashboard/help/{e.slug}
                        </code>
                        {noEnglish && (
                          <span
                            className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300"
                            title="English translation not yet available"
                          >
                            EN N/A
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-10 rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">
        <p>
          {isZh ? "📖 教材文件源：" : "📖 Source files: "}
          <code>src/content/manual/{"{slug}"}.zh.md</code> ·{" "}
          <code>{"{slug}"}.en.md</code>
        </p>
        <p className="mt-1">
          {isZh
            ? "新教材：写好 .md 文件后跑 npm run generate:manual，自动出现在此处。"
            : "Adding a manual: write the .md, run `npm run generate:manual`, then commit."}
        </p>
        <p className="mt-1">
          {isZh ? "当前已收录 " : "Currently indexed: "}
          <strong>{entries.length}</strong>
          {isZh
            ? ` 篇 / 共 ${totalPages} 个页面`
            : ` page${entries.length === 1 ? "" : "s"} of ${totalPages} planned`}
        </p>
      </div>
    </>
  );
}
