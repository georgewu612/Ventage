/**
 * Help Center — index page.
 *
 * Pure server component. Reads from the static manual manifest
 * (build-time bundled via webpack asset/source rule). Zero filesystem
 * dependencies at runtime — works identically locally and on Vercel.
 */
import { BookOpen, ChevronRight } from "lucide-react";
import Link from "next/link";

import { HelpSearch } from "@/components/help/HelpSearch";
import { MANUAL_ENTRIES, type ManualEntry } from "@/content/manual/manifest";

function groupBySection(entries: ManualEntry[]): Record<string, ManualEntry[]> {
  const groups: Record<string, ManualEntry[]> = {
    "00 总览": [],
    "L1 入口": [],
    "L2 核心": [],
    "L3 策略研究": [],
    "L4 数据情报": [],
    "L5 运营管理": [],
  };
  for (const e of entries) {
    if (e.slug.startsWith("00")) groups["00 总览"].push(e);
    else if (e.slug.startsWith("L1")) groups["L1 入口"].push(e);
    else if (e.slug.startsWith("L2")) groups["L2 核心"].push(e);
    else if (e.slug.startsWith("L3")) groups["L3 策略研究"].push(e);
    else if (e.slug.startsWith("L4")) groups["L4 数据情报"].push(e);
    else if (e.slug.startsWith("L5")) groups["L5 运营管理"].push(e);
  }
  return groups;
}

export default function HelpIndexPage() {
  const entries = MANUAL_ENTRIES;
  const groups = groupBySection(entries);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center gap-3">
        <BookOpen className="h-7 w-7 text-cyan-400" />
        <h1 className="text-3xl font-bold text-white">帮助中心 / Help</h1>
      </div>

      <p className="mb-6 text-slate-400">
        Ventage 全站使用教材。按模块组织 · 白话讲解 · 可搜索。
      </p>

      <HelpSearch entries={entries} />

      <div className="mt-8 space-y-8">
        {Object.entries(groups).map(([sectionName, items]) =>
          items.length === 0 ? null : (
            <section key={sectionName}>
              <h2 className="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">
                {sectionName}
              </h2>
              <div className="grid gap-2 md:grid-cols-2">
                {items.map((e) => (
                  <Link
                    key={e.slug}
                    href={`/dashboard/help/${e.slug}`}
                    className="group block rounded-lg border border-slate-800 bg-slate-900/40 p-4 transition hover:border-cyan-500/40 hover:bg-slate-900/70"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-white group-hover:text-cyan-300">
                        {e.title}
                      </h3>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-cyan-400" />
                    </div>
                    {e.excerpt && (
                      <p className="mt-2 line-clamp-2 text-sm text-slate-400">
                        {e.excerpt}
                      </p>
                    )}
                    <code className="mt-2 inline-block text-xs text-slate-500">
                      /dashboard/help/{e.slug}
                    </code>
                  </Link>
                ))}
              </div>
            </section>
          ),
        )}
      </div>

      <div className="mt-10 rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">
        <p>
          📖 教材文件源：<code>src/content/manual/*.md</code> ·
          内部审计（不公开）：
          <code>docs/audit/PAGE_AUDIT.md</code>
        </p>
        <p className="mt-1">
          新教材：写好 .md 文件并提交，自动出现在此处（构建时由
          <code>scripts/generate-manual.mjs</code> 扫描收录）。
        </p>
        <p className="mt-1">
          当前已收录 <strong>{entries.length}</strong> 篇 / 共 25 个页面
        </p>
      </div>
    </div>
  );
}
