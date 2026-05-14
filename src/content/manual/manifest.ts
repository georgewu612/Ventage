/**
 * Manual content manifest.
 *
 * Explicit imports of each .md file. Webpack ?raw / asset/source rule
 * (configured in next.config.ts) loads them as strings at build time, so
 * the help center has zero runtime filesystem dependencies — works on
 * Vercel serverless without any tracing config.
 *
 * To add a new manual page:
 *   1. Create src/content/manual/{slug}.md
 *   2. Import + register here (just two lines)
 *   3. The help center auto-discovers it
 */

// @ts-expect-error  – .md imported as string via webpack asset/source rule
import overview from "./00-overview.md";
// @ts-expect-error  – same
import l201Dashboard from "./L2-01-dashboard.md";

export interface ManualEntry {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
}

/** Extract `# Title` and a usable excerpt paragraph from raw markdown. */
function parseEntry(slug: string, body: string): ManualEntry {
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() ?? slug;

  const excerptMatch = body
    .replace(/^#.+$/gm, "")
    .replace(/^>.*$/gm, "")
    .split(/\n{2,}/)
    .find((p) => p.trim().length > 30 && !p.startsWith("---"));
  const excerpt = (excerptMatch ?? "").replace(/\s+/g, " ").slice(0, 160);

  return { slug, title, excerpt, body };
}

/** All manual entries, ordered by slug. */
export const MANUAL_ENTRIES: ManualEntry[] = [
  parseEntry("00-overview", overview as string),
  parseEntry("L2-01-dashboard", l201Dashboard as string),
].sort((a, b) => a.slug.localeCompare(b.slug));

/** Look up a single entry by slug (for /dashboard/help/[slug] route). */
export function getManualBySlug(slug: string): ManualEntry | null {
  return MANUAL_ENTRIES.find((e) => e.slug === slug) ?? null;
}
