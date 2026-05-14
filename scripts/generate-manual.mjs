#!/usr/bin/env node
/**
 * Regenerate src/content/manual/manifest.ts from all .md files in
 * src/content/manual/.
 *
 * Why directly rewrite manifest.ts (instead of a separate _generated file):
 * After multiple failed Vercel-deploy attempts using intermediate files
 * (webpack rules, file tracing, separate _generated.ts), it turned out
 * that the simplest reliable approach is to inline all markdown bodies
 * straight into manifest.ts as plain TypeScript template literals. No
 * bundler config, no build-time hooks needed — and the file is just a
 * normal import that always works on any bundler / hosting platform.
 *
 * Usage:
 *   npm run generate:manual    # after adding a new .md file
 *   git add src/content/manual/manifest.ts
 *   git commit
 *
 * Hooks: also runs automatically via npm predev + prebuild, but the
 * generated file is also committed, so Vercel doesn't depend on the hook.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const MANUAL_DIR = path.join(REPO_ROOT, "src", "content", "manual");
const OUT_FILE = path.join(MANUAL_DIR, "manifest.ts");

function escapeForTemplateLiteral(s) {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function main() {
  if (!fs.existsSync(MANUAL_DIR)) {
    console.error(`[generate-manual] Manual dir not found: ${MANUAL_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(MANUAL_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort();

  if (files.length === 0) {
    console.warn("[generate-manual] No manual files found.");
  }

  const lines = [];
  lines.push("/**");
  lines.push(
    " * Manual content manifest — AUTO-GENERATED, do not edit by hand.",
  );
  lines.push(" *");
  lines.push(" * Source files: src/content/manual/*.md");
  lines.push(" * Regenerate: npm run generate:manual");
  lines.push(" *");
  lines.push(
    " * Why inlined here (vs separate _generated.ts or webpack loaders):",
  );
  lines.push(
    " * direct inline export is the most bundler-agnostic approach; works on",
  );
  lines.push(
    " * any Next.js bundler (Turbopack / webpack / future) without config.",
  );
  lines.push(" */");
  lines.push("");
  lines.push("export interface ManualEntry {");
  lines.push("  slug: string;");
  lines.push("  title: string;");
  lines.push("  excerpt: string;");
  lines.push("  body: string;");
  lines.push("}");
  lines.push("");
  lines.push("const MANUAL_FILES: Record<string, string> = {");
  for (const f of files) {
    const slug = f.replace(/\.md$/, "");
    const body = fs.readFileSync(path.join(MANUAL_DIR, f), "utf-8");
    lines.push(
      `  ${JSON.stringify(slug)}: \`${escapeForTemplateLiteral(body)}\`,`,
    );
  }
  lines.push("};");
  lines.push("");
  lines.push("function parseEntry(slug: string, body: string): ManualEntry {");
  lines.push("  const titleMatch = body.match(/^#\\s+(.+)$/m);");
  lines.push("  const title = titleMatch?.[1]?.trim() ?? slug;");
  lines.push("  const excerptMatch = body");
  lines.push('    .replace(/^#.+$/gm, "")');
  lines.push('    .replace(/^>.*$/gm, "")');
  lines.push("    .split(/\\n{2,}/)");
  lines.push('    .find((p) => p.trim().length > 30 && !p.startsWith("---"));');
  lines.push(
    '  const excerpt = (excerptMatch ?? "").replace(/\\s+/g, " ").slice(0, 160);',
  );
  lines.push("  return { slug, title, excerpt, body };");
  lines.push("}");
  lines.push("");
  lines.push(
    "export const MANUAL_ENTRIES: ManualEntry[] = Object.entries(MANUAL_FILES)",
  );
  lines.push("  .map(([slug, body]) => parseEntry(slug, body))");
  lines.push("  .sort((a, b) => a.slug.localeCompare(b.slug));");
  lines.push("");
  lines.push(
    "export function getManualBySlug(slug: string): ManualEntry | null {",
  );
  lines.push("  return MANUAL_ENTRIES.find((e) => e.slug === slug) ?? null;");
  lines.push("}");
  lines.push("");

  fs.writeFileSync(OUT_FILE, lines.join("\n"), "utf-8");
  console.log(
    `[generate-manual] Wrote ${files.length} entries → ${path.relative(REPO_ROOT, OUT_FILE)}`,
  );
}

main();
