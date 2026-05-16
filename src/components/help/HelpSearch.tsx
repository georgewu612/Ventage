"use client";

import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useI18n } from "@/lib/i18n/provider";
import type { ManualEntry } from "@/content/manual/manifest";

interface Props {
  entries: ManualEntry[];
}

interface Hit {
  entry: ManualEntry;
  matchIdx: number;
  snippet: string;
  title: string;
}

function findHit(
  entry: ManualEntry,
  q: string,
  isZh: boolean,
): Hit | null {
  const lowerQ = q.toLowerCase();
  const title = isZh ? entry.titleZh : entry.titleEn;
  const body = isZh ? entry.bodyZh : (entry.bodyEn ?? entry.bodyZh);
  const lowerBody = body.toLowerCase();
  const titleHit = title.toLowerCase().includes(lowerQ);
  const bodyIdx = lowerBody.indexOf(lowerQ);
  if (!titleHit && bodyIdx < 0) return null;

  let snippet = "";
  if (bodyIdx >= 0) {
    const start = Math.max(0, bodyIdx - 50);
    const end = Math.min(body.length, bodyIdx + q.length + 80);
    snippet = body.slice(start, end).replace(/\s+/g, " ").trim();
  } else {
    snippet = isZh ? entry.excerptZh : entry.excerptEn;
  }
  return { entry, matchIdx: Math.max(bodyIdx, 0), snippet, title };
}

function highlight(text: string, q: string) {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-cyan-500/30 text-cyan-200">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export function HelpSearch({ entries }: Props) {
  const { locale } = useI18n();
  const isZh = locale === "zh";
  const [q, setQ] = useState("");

  const hits = useMemo<Hit[]>(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) return [];
    return entries
      .map((e) => findHit(e, trimmed, isZh))
      .filter((h): h is Hit => h !== null)
      .slice(0, 10);
  }, [q, entries, isZh]);

  return (
    <div>
      <div className="relative">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            isZh
              ? "搜索教材内容（如：信号 / 形态 / DCF）"
              : "Search the manual (e.g. signal / pattern / DCF)"
          }
          className="w-full rounded-lg border border-slate-700 bg-slate-900/40 py-2.5 pr-3 pl-10 text-sm text-white placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none"
        />
      </div>

      {q.trim().length >= 2 && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/40">
          {hits.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">
              {isZh ? "未找到「" : "No results for «"}
              <span className="text-slate-300">{q}</span>
              {isZh ? "」相关内容" : "»"}
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {hits.map((h) => (
                <li key={h.entry.slug}>
                  <Link
                    href={`/dashboard/help/${h.entry.slug}`}
                    className="group flex items-start gap-3 px-4 py-3 transition hover:bg-slate-800/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-white group-hover:text-cyan-300">
                        {highlight(h.title, q)}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-slate-400">
                        ... {highlight(h.snippet, q)} ...
                      </div>
                      <code className="mt-1 text-[10px] text-slate-600">
                        {h.entry.slug}
                      </code>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-cyan-400" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
