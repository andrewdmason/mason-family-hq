"use client";

import { Sparkles } from "lucide-react";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { memberPhotoUrl } from "@/lib/media/member-photo-url";
import type { MentionTarget } from "@/lib/reading/mentions";

/**
 * The @ menu.
 *
 * Two things about it are deliberate and both are about not losing the caret.
 *
 * It is NOT a dropdown menu. Menus move focus, and focus leaving the textarea
 * dismisses the keyboard on iOS — so the reader would tap a name and watch the
 * composer collapse. Everything here is driven from the textarea's own key
 * handler; this component never takes focus at all, which is why it has no
 * tabIndex and why its rows are divs.
 *
 * And it renders inside the panel rather than in a portal. The panel closes on
 * any pointerdown outside itself while the thread is still untouched — which is
 * exactly the moment you are most likely to be mentioning somebody, since that
 * is usually the first thing written on a passage. A portalled menu would be
 * outside, so the first tap on a name would close the panel it belongs to.
 */
export function MentionTypeahead({
  candidates,
  activeIndex,
  onPick,
}: {
  candidates: MentionTarget[];
  activeIndex: number;
  onPick: (target: MentionTarget) => void;
}) {
  if (candidates.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Mention someone"
      className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-[40vh] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
    >
      {candidates.map((t, i) => (
        <div
          key={t.handle}
          role="option"
          aria-selected={i === activeIndex}
          // Mouse down rather than click: click fires after the textarea has
          // already lost focus, and on touch that is a keyboard dismissal you
          // can see happen.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(t);
          }}
          className={[
            "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
            i === activeIndex ? "bg-accent text-accent-foreground" : "",
          ].join(" ")}
        >
          {t.kind === "ai" ? (
            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-2.5 w-2.5" />
            </span>
          ) : (
            <MemberAvatar
              name={t.name}
              url={t.hasPhoto && t.email ? memberPhotoUrl(t.email) : null}
              size="xs"
            />
          )}
          <span className="font-medium">{t.name}</span>
          <span className="text-xs text-muted-foreground">@{t.handle}</span>
          {t.kind === "ai" ? (
            <span className="ml-auto text-[11px] text-muted-foreground">
              answers here
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * What the reader is part-way through typing, if anything.
 *
 * An @ only opens the menu at the start of the text or after whitespace or an
 * opening bracket — the same rule the parser uses, so an email address never
 * summons a menu of the family.
 */
export function mentionQueryAt(
  text: string,
  caret: number
): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at < 0) return null;

  const before = at === 0 ? "" : upto[at - 1];
  if (before && !/[\s([{"'—–-]/.test(before)) return null;

  const query = upto.slice(at + 1);
  // A space closes it. So does anything that could not be part of a handle,
  // which keeps the menu from hanging around over punctuation.
  if (!/^[a-zA-Z0-9]*$/.test(query)) return null;

  return { query: query.toLowerCase(), start: at };
}

export function matchTargets(
  targets: MentionTarget[],
  query: string
): MentionTarget[] {
  const q = query.toLowerCase();
  return targets
    .filter(
      (t) => t.handle.startsWith(q) || t.name.toLowerCase().startsWith(q)
    )
    .slice(0, 6);
}
