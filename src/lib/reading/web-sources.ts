import type Anthropic from "@anthropic-ai/sdk";

/**
 * The output side of a turn that searched the web — shared by the anchored chat
 * and the afterword interview, which are different routes with different
 * prompts but must behave identically once a search happens.
 *
 * Two things live here because both have a wrong-looking obvious version:
 *
 *  - THE SOURCE LIST IS BUILT FROM CITATIONS, not from search results. A search
 *    returns ten pages; the answer leans on two. Citations are attached by the
 *    model to the sentences that actually used them, so this lists what the
 *    answer rests on rather than what the search happened to surface.
 *  - THE APP WRITES THE LINE, not the model. Asked to list its own sources a
 *    model does it most of the time, which is worse than either always or
 *    never: the reader can't tell a searched answer from an unsearched one.
 */

/** What the panel shows while a search is running. See chat-stream.ts. */
export const SEARCHING_STATUS = "Searching the web…";

/**
 * How many times a paused turn may be resumed.
 *
 * A turn that uses the search tool can come back `pause_turn` instead of
 * finishing — the server-side tool loop hit its own iteration limit. Resuming is
 * just re-sending the conversation with the paused turn on the end. Bounded
 * because the alternative is a loop, and two rounds is far more than a
 * four-search cap can actually need.
 */
export const MAX_SEARCH_RESUMES = 2;

/**
 * A source, rendered as the markdown link that goes under the answer.
 *
 * The title is what the page calls itself, which is usually right and
 * occasionally a hundred characters of SEO; capped rather than trusted. Square
 * brackets and parentheses come out because this becomes a markdown link, and a
 * title containing either would end the link early and leave a URL on screen.
 */
export function sourceLink(title: string | null, url: string): string {
  let label = (title ?? "").replace(/[[\]]/g, "").trim();
  if (!label) {
    try {
      label = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      label = url;
    }
  }
  if (label.length > 48) label = `${label.slice(0, 47).trimEnd()}…`;
  return `[${label}](${url.replace(/\)/g, "%29")})`;
}

/**
 * Fold a finished message's web citations into `into`, keyed by URL.
 *
 * A Map rather than a list so a page cited three times is listed once, in the
 * order it was first leaned on — and so this can be called for each round of a
 * turn that paused and resumed without the caller deduplicating afterwards.
 */
export function collectWebSources(
  content: Anthropic.ContentBlock[],
  into: Map<string, string>
): void {
  for (const block of content) {
    if (block.type !== "text" || !block.citations) continue;
    for (const citation of block.citations) {
      if (citation.type !== "web_search_result_location") continue;
      if (into.has(citation.url)) continue;
      into.set(citation.url, sourceLink(citation.title, citation.url));
    }
  }
}

/**
 * The line that goes under a searched answer, or null when nothing was cited.
 *
 * Returned with its leading blank line so callers can append it to the streamed
 * text and to the persisted text identically — a reload should show exactly
 * what the reader watched arrive.
 */
export function sourcesLine(sources: Map<string, string>): string | null {
  if (sources.size === 0) return null;
  return `\n\nSources: ${[...sources.values()].join(" · ")}`;
}
