/**
 * Help Center — index page.
 *
 * Thin server wrapper. All locale-aware UI lives inside <HelpIndex/>
 * (client component) so the H1/heading reflects the user's chosen
 * language without an extra render-roundtrip.
 */
import { HelpIndex } from "@/components/help/HelpIndex";
import { MANUAL_ENTRIES } from "@/content/manual/manifest";

export default function HelpIndexPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <HelpIndex entries={MANUAL_ENTRIES} totalPages={25} />
    </div>
  );
}
