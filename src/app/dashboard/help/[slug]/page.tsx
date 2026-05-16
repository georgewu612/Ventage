/**
 * Help Center — single-page renderer (locale-aware via client wrapper).
 *
 * Server component fetches the entry, then hands off to <ManualPage/>
 * which reads the user's locale and renders the right body (with a
 * fallback notice when only Chinese is available).
 */
import { notFound } from "next/navigation";

import { ManualPage } from "@/components/help/ManualPage";
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
  return <ManualPage entry={entry} />;
}
