#!/usr/bin/env node
/**
 * Regenerate src/content/manual/manifest.ts from all .md files in
 * src/content/manual/.
 *
 * Locale convention:
 *   {slug}.zh.md  → Chinese version (primary)
 *   {slug}.en.md  → English version (optional, falls back to zh)
 *   {slug}.md     → treated as zh (legacy, for back-compat)
 *
 * Output: a single MANUAL_FILES record keyed by slug, each value being
 *   { zh: string; en: string | null }
 *
 * Why inline into manifest.ts instead of separate _generated.ts:
 * After multiple Vercel-deploy attempts, inlining proved to be the only
 * reliable cross-bundler approach. Vercel's .vercelignore strips *.md
 * from the build, so the script can't run on Vercel — manifest.ts must
 * already contain everything pre-committed.
 *
 * Workflow:
 *   1. Add/edit .md files in src/content/manual/
 *   2. Run `npm run generate:manual`
 *   3. git add src/content/manual/manifest.ts (+ the .md)
 *   4. Commit + push — Vercel uses the committed manifest.ts as-is.
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

/** Group filenames into a `{ slug: { zh, en } }` map. */
function collectFiles() {
  if (!fs.existsSync(MANUAL_DIR)) {
    console.error(`[generate-manual] Manual dir not found: ${MANUAL_DIR}`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(MANUAL_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md");

  const map = {}; // slug → { zh: string|null, en: string|null }
  for (const f of files) {
    let slug, lang;
    if (f.endsWith(".zh.md")) {
      slug = f.replace(/\.zh\.md$/, "");
      lang = "zh";
    } else if (f.endsWith(".en.md")) {
      slug = f.replace(/\.en\.md$/, "");
      lang = "en";
    } else {
      // Legacy: bare .md treated as zh
      slug = f.replace(/\.md$/, "");
      lang = "zh";
    }
    map[slug] ??= { zh: null, en: null };
    map[slug][lang] = fs.readFileSync(path.join(MANUAL_DIR, f), "utf-8");
  }
  return map;
}

function main() {
  const filesBySlug = collectFiles();
  const slugs = Object.keys(filesBySlug).sort();
  if (slugs.length === 0) {
    console.warn("[generate-manual] No manual files found.");
  }

  const lines = [];
  lines.push("/**");
  lines.push(" * Manual content manifest — AUTO-GENERATED, do not edit by hand.");
  lines.push(" *");
  lines.push(" * Source files: src/content/manual/{slug}.{zh|en}.md");
  lines.push(" * Regenerate:   npm run generate:manual");
  lines.push(" *");
  lines.push(" * Locale convention: {slug}.zh.md is required, {slug}.en.md is optional.");
  lines.push(" * Pages without an .en.md fall back to .zh.md with a UI notice.");
  lines.push(" */");
  lines.push("");
  lines.push("export interface ManualEntry {");
  lines.push("  slug: string;");
  lines.push("  titleZh: string;");
  lines.push("  titleEn: string;");
  lines.push("  excerptZh: string;");
  lines.push("  excerptEn: string;");
  lines.push("  bodyZh: string;");
  lines.push("  /** Null when no .en.md exists; UI must fall back to bodyZh + show notice. */");
  lines.push("  bodyEn: string | null;");
  lines.push("}");
  lines.push("");
  lines.push("interface RawEntry { zh: string; en: string | null }");
  lines.push("");
  lines.push("const MANUAL_FILES: Record<string, RawEntry> = {");
  for (const slug of slugs) {
    const e = filesBySlug[slug];
    if (!e.zh) {
      console.warn(`[generate-manual] '${slug}' has no .zh.md — treating .en.md as primary.`);
      e.zh = e.en ?? "";
    }
    const zhLit = "`" + escapeForTemplateLiteral(e.zh) + "`";
    const enLit = e.en ? "`" + escapeForTemplateLiteral(e.en) + "`" : "null";
    lines.push(`  ${JSON.stringify(slug)}: {`);
    lines.push(`    zh: ${zhLit},`);
    lines.push(`    en: ${enLit},`);
    lines.push("  },");
  }
  lines.push("};");
  lines.push("");
  lines.push("function extractTitle(body: string, slug: string): string {");
  lines.push("  const m = body.match(/^#\\s+(.+)$/m);");
  lines.push("  return m?.[1]?.trim() ?? slug;");
  lines.push("}");
  lines.push("");
  lines.push("function extractExcerpt(body: string): string {");
  lines.push("  const para = body");
  lines.push("    .replace(/^#.+$/gm, \"\")");
  lines.push("    .replace(/^>.*$/gm, \"\")");
  lines.push("    .split(/\\n{2,}/)");
  lines.push("    .find((p) => p.trim().length > 30 && !p.startsWith(\"---\"));");
  lines.push("  return (para ?? \"\").replace(/\\s+/g, \" \").slice(0, 160);");
  lines.push("}");
  lines.push("");
  lines.push("export const MANUAL_ENTRIES: ManualEntry[] = Object.entries(MANUAL_FILES)");
  lines.push("  .map(([slug, raw]) => ({");
  lines.push("    slug,");
  lines.push("    titleZh: extractTitle(raw.zh, slug),");
  lines.push("    titleEn: raw.en ? extractTitle(raw.en, slug) : extractTitle(raw.zh, slug),");
  lines.push("    excerptZh: extractExcerpt(raw.zh),");
  lines.push("    excerptEn: raw.en ? extractExcerpt(raw.en) : extractExcerpt(raw.zh),");
  lines.push("    bodyZh: raw.zh,");
  lines.push("    bodyEn: raw.en,");
  lines.push("  }))");
  lines.push("  .sort((a, b) => a.slug.localeCompare(b.slug));");
  lines.push("");
  lines.push("export function getManualBySlug(slug: string): ManualEntry | null {");
  lines.push("  return MANUAL_ENTRIES.find((e) => e.slug === slug) ?? null;");
  lines.push("}");
  lines.push("");

  fs.writeFileSync(OUT_FILE, lines.join("\n"), "utf-8");
  const enCount = slugs.filter((s) => filesBySlug[s].en).length;
  console.log(
    `[generate-manual] Wrote ${slugs.length} entries → ${path.relative(REPO_ROOT, OUT_FILE)} (${enCount} have .en.md)`,
  );
}

main();
