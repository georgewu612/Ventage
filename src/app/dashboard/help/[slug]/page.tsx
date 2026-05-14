/**
 * Help Center — single-page renderer.
 *
 * Pure server component. Reads from the static manual manifest (build-
 * time bundled via webpack asset/source rule). Zero filesystem deps at
 * runtime — works on Vercel without any tracing config.
 */
import { ArrowLeft, BookOpen } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { MANUAL_ENTRIES, getManualBySlug } from "@/content/manual/manifest";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return MANUAL_ENTRIES.map((e) => ({ slug: e.slug }));
}

export default async function HelpPage({ params }: PageProps) {
  const { slug } = await params;
  const entry = getManualBySlug(slug);
  if (!entry) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-3 text-sm">
        <Link
          href="/dashboard/help"
          className="flex items-center gap-1 text-slate-400 transition hover:text-cyan-400"
        >
          <ArrowLeft className="h-4 w-4" />
          <BookOpen className="h-4 w-4" />
          帮助中心
        </Link>
        <span className="text-slate-700">/</span>
        <code className="text-xs text-slate-500">{slug}</code>
      </div>

      <article className="prose-help">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="mt-2 mb-4 border-b border-slate-800 pb-3 text-3xl font-bold text-white">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="mt-8 mb-3 text-2xl font-semibold text-cyan-300">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="mt-6 mb-2 text-xl font-semibold text-white">
                {children}
              </h3>
            ),
            h4: ({ children }) => (
              <h4 className="mt-4 mb-2 text-base font-semibold text-slate-200">
                {children}
              </h4>
            ),
            p: ({ children }) => (
              <p className="mb-3 leading-relaxed text-slate-300">{children}</p>
            ),
            ul: ({ children }) => (
              <ul className="mb-3 list-disc space-y-1 pl-6 text-slate-300">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="mb-3 list-decimal space-y-1 pl-6 text-slate-300">
                {children}
              </ol>
            ),
            li: ({ children }) => (
              <li className="leading-relaxed">{children}</li>
            ),
            strong: ({ children }) => (
              <strong className="font-semibold text-white">{children}</strong>
            ),
            em: ({ children }) => <em className="text-cyan-300">{children}</em>,
            blockquote: ({ children }) => (
              <blockquote className="my-4 border-l-4 border-cyan-500/40 bg-cyan-500/5 py-2 pl-4 text-slate-300 italic">
                {children}
              </blockquote>
            ),
            code: ({ className, children }) => {
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
            table: ({ children }) => (
              <div className="my-4 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => (
              <thead className="border-b border-slate-700 text-slate-400">
                {children}
              </thead>
            ),
            th: ({ children }) => (
              <th className="px-3 py-2 text-left text-xs font-semibold tracking-wider uppercase">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border-b border-slate-800 px-3 py-2 text-slate-300">
                {children}
              </td>
            ),
            a: ({ href, children }) => (
              <Link
                href={href ?? "#"}
                className="text-cyan-400 underline-offset-2 hover:underline"
              >
                {children}
              </Link>
            ),
            hr: () => <hr className="my-8 border-slate-800" />,
          }}
        >
          {entry.body}
        </ReactMarkdown>
      </article>

      <div className="mt-12 flex items-center justify-between border-t border-slate-800 pt-6 text-xs text-slate-500">
        <Link
          href="/dashboard/help"
          className="flex items-center gap-1 hover:text-cyan-400"
        >
          <ArrowLeft className="h-3 w-3" /> 返回帮助中心
        </Link>
        <span>
          源文件：<code>src/content/manual/{slug}.md</code>
        </span>
      </div>
    </div>
  );
}
