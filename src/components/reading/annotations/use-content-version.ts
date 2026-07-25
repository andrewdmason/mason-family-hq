"use client";

import { useEffect, useState } from "react";

/**
 * A counter that ticks whenever the rendered content under `contentRef` is
 * replaced.
 *
 * Everything that marks up the reader — the painted ranges, the margin icons —
 * is derived from DOM that arrives asynchronously and can be swapped out from
 * under it. The book HTML comes from a signed storage URL long after the
 * annotations come from the database, and React re-applies it through
 * dangerouslySetInnerHTML, which destroys and recreates every text node.
 *
 * That is fatal for the highlights in particular, and silently so: a live Range
 * whose nodes have been removed COLLAPSES rather than erroring. CSS.highlights
 * still holds it, the ::highlight() rules still parse, and nothing paints —
 * which is exactly the symptom this was written to fix. Deriving anything from
 * this DOM means re-deriving it when the DOM changes, and layoutNonce is bumped
 * on its own schedule that does not reliably line up.
 */
export function useContentVersion(
  contentRef: React.RefObject<HTMLDivElement | null>
): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    // Coalesced to one bump per frame: injecting a book fires a great many
    // mutation records at once, and re-deriving per record would be quadratic
    // in a way nobody would notice until a long book made it obvious.
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        setVersion((v) => v + 1);
      });
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [contentRef]);

  return version;
}
