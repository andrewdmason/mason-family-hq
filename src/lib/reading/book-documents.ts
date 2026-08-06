/**
 * The reader's own front and back matter: a preface written before a book, an
 * afterword written after it.
 *
 * Pure and client-safe. Everything here is shared vocabulary — the client and
 * the server both name these things, and a thread whose header says one word
 * while its transcript says another reads as two different features.
 */

/** Which of the two documents a book-scoped annotation is. */
export type BookScope = "preface" | "afterword";

export const BOOK_SCOPES: readonly BookScope[] = ["preface", "afterword"];

export function isBookScope(value: unknown): value is BookScope {
  return value === "preface" || value === "afterword";
}

/**
 * What the Contents calls each one.
 *
 * Possessive on purpose. Plenty of books ship with a preface or an afterword of
 * their own, and those stay where the author put them — in the book's own
 * contents tree. Yours are the ones with your name on them, outside the tree at
 * either end of it.
 */
export const BOOK_DOCUMENT_LABEL: Record<BookScope, string> = {
  preface: "Your preface",
  afterword: "Your afterword",
};

/** The bare noun, for sentences that already say whose it is. */
export const BOOK_DOCUMENT_NOUN: Record<BookScope, string> = {
  preface: "preface",
  afterword: "afterword",
};

/** One line under the title in the Contents, before either has been written. */
export const BOOK_DOCUMENT_BLURB: Record<BookScope, string> = {
  preface: "Think through why you're reading this",
  afterword: "What you're taking from it, in your own words",
};

/**
 * How the interview works, shown once it has started and until something is
 * written. The escape hatch is the load-bearing half: an interview you can't
 * leave is a form, and nobody fills in a form about a book they just finished.
 */
export const BOOK_DOCUMENT_INTERVIEW_HINT =
  "One question at a time. Say “just write it” whenever you've had enough.";

/**
 * What the button that generates the document says.
 *
 * There is no "write a new one". A written preface has exactly one control —
 * the bin — and starting over means starting over: delete it and the interview
 * that made it, and do it again from nothing. That is a smaller thing to
 * explain than a regenerate that appends, an interview you can resume, and a
 * page that has to show you which version you are looking at.
 */
export function writeDocumentLabel(scope: BookScope): string {
  return scope === "preface" ? "Write the preface" : "Write the afterword";
}

/**
 * The line that sits above the document.
 *
 * Dated because when you wrote it is part of what it is — an afterword written
 * the week you finished a book and one written a year later are different
 * things, and the only one you keep should say which it was.
 */
export function documentHeading(scope: BookScope, writtenAt: string | null): string {
  const label = BOOK_DOCUMENT_LABEL[scope];
  if (!writtenAt) return label;
  const when = new Date(writtenAt);
  if (Number.isNaN(when.getTime())) return label;
  return `${label} · ${when.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

/** One turn of the conversation as the API takes it. */
export type DocumentTurn = { role: "user" | "assistant"; content: string };

/**
 * The transcript, shaped into a conversation the API will accept.
 *
 * Two things are true of every request and neither is true of this thread on its
 * own. It must START with a user turn — but an interview's transcript starts
 * with the question the assistant asked. And it must END with one — but pressing
 * "write it" sends no words, so the transcript ends on the last question, and
 * the model reads a trailing assistant turn as a prefill it will not accept.
 * That second case is a 400 the reader sees only at the moment they ask for the
 * thing the whole interview was for.
 *
 * Both are patched with turns that are never persisted. The transcript is a
 * record of what was actually said, and an app-authored "write it now" sitting
 * in it would make it a record of the plumbing instead. The instruction the
 * model acts on lives in the system prompt; these only make the envelope legal.
 *
 * Pure, and separated from the route, because this is exactly the kind of
 * off-by-one-turn rule that is invisible until it 400s in front of someone.
 */
export function buildDocumentTurns(
  transcript: DocumentTurn[],
  phase: "converse" | "document",
  scope: BookScope,
  bookTitle: string
): DocumentTurn[] {
  const turns = transcript.map((t) => ({ ...t }));

  // Fold consecutive same-role turns: a note followed by the question it
  // prompted is two user turns in a row, which is permitted but pointless.
  const folded: DocumentTurn[] = [];
  for (const turn of turns) {
    const last = folded.at(-1);
    if (last && last.role === turn.role) last.content += `\n\n${turn.content}`;
    else folded.push(turn);
  }

  if (folded.length > 0 && folded.at(-1)!.role !== "user") {
    folded.push({
      role: "user",
      content:
        phase === "document"
          ? `That's enough — write my ${BOOK_DOCUMENT_NOUN[scope]} now.`
          : "Go on.",
    });
  }

  if (folded.length === 0 || folded[0].role !== "user") {
    // Deliberately neutral, and deliberately NOT "write it now" even when that
    // is what this call is for: at the top of the transcript it would read as
    // the reader demanding a document before the interview it came out of.
    folded.unshift({
      role: "user",
      content: `Let's do my ${BOOK_DOCUMENT_NOUN[scope]} for ${bookTitle}.`,
    });
  }

  return folded;
}
