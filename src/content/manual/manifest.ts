/**
 * Manual content manifest — public API for the help center.
 *
 * Loads from `_generated.ts` (auto-generated from `*.md` files by
 * `scripts/generate-manual.mjs`, which runs in npm `prebuild` + `predev`
 * hooks).
 *
 * To add a new manual page: just drop a new `.md` file in this directory.
 * The generator picks it up on next dev/build — zero code edits needed.
 */
import { MANUAL_FILES } from "./_generated";

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
export const MANUAL_ENTRIES: ManualEntry[] = Object.entries(MANUAL_FILES)
  .map(([slug, body]) => parseEntry(slug, body))
  .sort((a, b) => a.slug.localeCompare(b.slug));

/** Look up a single entry by slug (for /dashboard/help/[slug] route). */
export function getManualBySlug(slug: string): ManualEntry | null {
  return MANUAL_ENTRIES.find((e) => e.slug === slug) ?? null;
}
