/**
 * Help Center — index page (locale-aware).
 *
 * Pure server component. Reads from the static manual manifest. We can't
 * detect locale on the server here (the I18n provider lives client-side
 * via cookie/localStorage), so the index renders BOTH zh and en titles
 * and lets a small client component pick the right one.
 */
import { BookOpen } from "lucide-react";

import { HelpIndex } from "@/components/help/HelpIndex";
import { MANUAL_ENTRIES } from "@/content/manual/manifest";

export default function HelpIndexPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center gap-3">
        <BookOpen className="h-7 w-7 text-cyan-400" />
        <h1 className="text-3xl font-bold text-white">帮助中心 / Help</h1>
      </div>
      <HelpIndex entries={MANUAL_ENTRIES} totalPages={25} />
    </div>
  );
}
