"use client";

import { AlertCircle, ArrowLeft, BookOpen } from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useI18n } from "@/lib/i18n/provider";
import type { ManualEntry } from "@/content/manual/manifest";

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mt-2 mb-4 border-b border-slate-800 pb-3 text-3xl font-bold text-white">
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mt-8 mb-3 text-2xl font-semibold text-cyan-300">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mt-6 mb-2 text-xl font-semibold text-white">{children}</h3>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="mt-4 mb-2 text-base font-semibold text-slate-200">
      {children}
    </h4>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-3 leading-relaxed text-slate-300">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-3 list-disc space-y-1 pl-6 text-slate-300">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-6 text-slate-300">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="text-cyan-300">{children}</em>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-4 border-l-4 border-cyan-500/40 bg-cyan-500/5 py-2 pl-4 text-slate-300 italic">
      {children}
    </blockquote>
  ),
  code: ({
    className,
    children,
  }: {
    className?: string;
    children?: React.ReactNode;
  }) => {
    const isBlock = (className ?? "").includes("language-");
    if (isBlock) {
      return (
        <pre className="my-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs">
          <code className="font-mono text-slate-200">{children}</code>
        </pre>
      );
    }
    return (
      <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-cyan-300">
        {children}
      </code>
    );
  },
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="border-b border-slate-700 text-slate-400">
      {children}
    </thead>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-2 text-left text-xs font-semibold tracking-wider uppercase">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border-b border-slate-800 px-3 py-2 text-slate-300">
      {children}
    </td>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <Link
      href={href ?? "#"}
      className="text-cyan-400 underline-offset-2 hover:underline"
    >
      {children}
    </Link>
  ),
  hr: () => <hr className="my-8 border-slate-800" />,
};

export function ManualPage({ entry }: { entry: ManualEntry }) {
  const { locale } = useI18n();
  const isZh = locale === "zh";
  const useFallback = !isZh && !entry.bodyEn;
  const body = isZh ? entry.bodyZh : (entry.bodyEn ?? entry.bodyZh);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-3 text-sm">
        <Link
          href="/dashboard/help"
          className="flex items-center gap-1 text-slate-400 transition hover:text-cyan-400"
        >
          <ArrowLeft className="h-4 w-4" />
          <BookOpen className="h-4 w-4" />
          {isZh ? "帮助中心" : "Help Center"}
        </Link>
        <span className="text-slate-700">/</span>
        <code className="text-xs text-slate-500">{entry.slug}</code>
      </div>

      {useFallback && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong>English version not available yet.</strong> Showing the
            Chinese original below. Source file:{" "}
            <code className="font-mono text-xs">
              src/content/manual/{entry.slug}.zh.md
            </code>
            . To contribute the English translation, add{" "}
            <code className="font-mono text-xs">
              src/content/manual/{entry.slug}.en.md
            </code>
            .
          </div>
        </div>
      )}

      <article className="prose-help">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {body}
        </ReactMarkdown>
      </article>

      <div className="mt-12 flex items-center justify-between border-t border-slate-800 pt-6 text-xs text-slate-500">
        <Link
          href="/dashboard/help"
          className="flex items-center gap-1 hover:text-cyan-400"
        >
          <ArrowLeft className="h-3 w-3" />{" "}
          {isZh ? "返回帮助中心" : "Back to Help Center"}
        </Link>
        <span>
          {isZh ? "源文件：" : "Source: "}
          <code>
            src/content/manual/{entry.slug}.
            {isZh ? "zh" : entry.bodyEn ? "en" : "zh"}.md
          </code>
        </span>
      </div>
    </div>
  );
}
