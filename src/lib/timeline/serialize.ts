import type { TimelineEntryWithPeople } from "@/lib/types";
import { CATEGORY_LABEL } from "./config";
import { formatTimelineRange, isUpcoming } from "./format";

/**
 * Render the viewer's timeline as a compact, chronological block for the
 * interviewer prompt — the structured replacement for the old free-text Past
 * doc. `linkedCount` here should reflect the viewer's OWN reflections, so the
 * "[elaborated]" flag tells the interviewer which events not to re-ask about.
 *
 * Returns just the line block (no header); buildSystemPrompt wraps it.
 */
export function serializeTimelineForPrompt(
  entries: TimelineEntryWithPeople[],
  today: string
): string {
  return entries
    .map((e) => {
      const date = formatTimelineRange(e);
      const upcoming = isUpcoming(e, today) ? " (upcoming)" : "";
      const elaborated =
        e.linkedCount > 0
          ? ` [elaborated${e.linkedCount > 1 ? ` x${e.linkedCount}` : ""}]`
          : "";
      return `- ${date}${upcoming} — ${e.title} [${CATEGORY_LABEL[e.category]}] (${e.prominence})${elaborated}`;
    })
    .join("\n");
}
