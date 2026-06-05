import "server-only";

import { generateCandidates } from "@/lib/journal/opening-candidates";
import type { HomeJournalAudience, HomeJournalSuggestion } from "./types";

/**
 * The widget_key under which a journal-suggestions set is cached for the day.
 * One set per audience: the personal-journal widget caches its "private" set,
 * the family-journal widget its "family" set.
 */
export function suggestionsWidgetKey(audience: HomeJournalAudience): string {
  return `journal_${audience}_v2`;
}

/**
 * Generate the day's opening-question suggestions for a Home journal widget,
 * reusing the journal's own `generateCandidates`. Passing an empty entry id makes
 * loadHistory fall back to "everything before today" (there's no live entry to
 * exclude), so these are standalone teasers. The audience frames the questions
 * and forces each candidate's visibility ("private" for the personal widget,
 * "family" for the family widget) — so a tapped suggestion lands in the right
 * app. Returns whatever count the user's questions-per-day setting produces
 * (default 3).
 */
export async function generateHomeSuggestions(
  audience: HomeJournalAudience,
  tz: string
): Promise<HomeJournalSuggestion[]> {
  const candidates = await generateCandidates(
    "",
    [],
    undefined,
    tz,
    null,
    null,
    audience
  );
  return candidates.map((c) => ({ text: c.text, visibility: c.visibility }));
}
