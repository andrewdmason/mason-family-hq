/**
 * Who you can name in a mark, and what naming them does.
 *
 * The composer used to have two Enters: one asked the model, one kept a note.
 * That split existed because there were two audiences and only one box. There
 * are three audiences now — you, the other person, and the model — and a modal
 * key combination does not scale to three. So the text says who it is for:
 * `@jenny` brings her in, `@nor` gets an answer, both together do both.
 *
 * Deliberately isomorphic. The typeahead in the composer and the server that
 * decides who gets notified must agree on what counts as a mention down to the
 * character, and the only way to guarantee that is for there to be one
 * implementation. The client's parse drives autocomplete and highlighting; the
 * server re-parses from scratch and never trusts what the client sent, because a
 * client-supplied recipient list is a grant somebody else wrote.
 */

/**
 * The assistant's handle.
 *
 * Reserved: a family member called Nora does not get it. Two things named `@nor`
 * would make every message in the app ambiguous, and losing the handle is a
 * smaller cost to one person than ambiguity is to everyone.
 */
export const NOR_HANDLE = "nor";

/** The assistant's name, for anywhere it is shown rather than typed. */
export const NOR_NAME = "Nor";

export type MentionTarget = {
  /** What you type after the @. Lowercase, unique across the family. */
  handle: string;
  kind: "member" | "ai";
  /** Null for Nor, who is not a person and has no inbox. */
  email: string | null;
  /** Null until they have signed in at least once. */
  userId: string | null;
  /** Shown in the picker and on their turns in the transcript. */
  name: string;
  /** Whether an avatar will actually load. The photo route 404s for a member
   *  who has none, and a 404 renders as a broken image rather than as initials,
   *  so this is checked rather than attempted. */
  hasPhoto: boolean;
};

export type ParsedMention = {
  handle: string;
  target: MentionTarget;
  /** Character offsets into the message, so a saved message renders its chips
   *  from what the server decided rather than by parsing again on the client. */
  start: number;
  len: number;
};

export type RosterMember = {
  email: string;
  name: string | null;
  userId: string | null;
  hasPhoto: boolean;
};

/** Everything mentionable, Nor included, with handles already disambiguated. */
export function mentionTargets(members: RosterMember[]): MentionTarget[] {
  const nor: MentionTarget = {
    handle: NOR_HANDLE,
    kind: "ai",
    email: null,
    userId: null,
    name: NOR_NAME,
    hasPhoto: false,
  };

  // First name, lowercased, falling back to the email's local part for a member
  // who has no name yet. Two Jennys get `jennyw` and `jennym`; if even that
  // collides the whole local part is the handle, which is ugly and unambiguous
  // — the right way round for something that decides who can read your writing.
  const taken = new Set<string>([NOR_HANDLE]);
  const targets: MentionTarget[] = [];

  for (const m of members) {
    const local = m.email.split("@")[0]?.toLowerCase() ?? "";
    const parts = (m.name ?? "").trim().split(/\s+/).filter(Boolean);
    const first = normalizeHandle(parts[0] ?? local);
    const lastInitial = normalizeHandle(parts.at(-1)?.[0] ?? "");

    const candidates = [
      first,
      lastInitial ? `${first}${lastInitial}` : "",
      normalizeHandle(local),
    ].filter(Boolean);

    const handle = candidates.find((c) => !taken.has(c)) ?? normalizeHandle(m.email);
    taken.add(handle);

    targets.push({
      handle,
      kind: "member",
      email: m.email,
      userId: m.userId,
      name: (m.name ?? "").trim() || m.email.split("@")[0],
      hasPhoto: m.hasPhoto,
    });
  }

  return [nor, ...targets];
}

function normalizeHandle(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * An @ only starts a mention at the beginning of the text or after whitespace or
 * an opening bracket. Without that rule `andrew@mason.io` is a mention of the
 * family member whose handle happens to be `mason` — which is the sort of thing
 * that works for a year and then quietly shares a passage with the wrong person.
 */
const MENTION_RE = /(^|[\s([{"'—–-])@([a-z0-9]+)/gi;

export function parseMentions(
  text: string,
  targets: MentionTarget[]
): ParsedMention[] {
  const byHandle = new Map(targets.map((t) => [t.handle, t]));
  const found: ParsedMention[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(MENTION_RE)) {
    const handle = m[2].toLowerCase();
    const target = byHandle.get(handle);
    if (!target) continue;
    // Naming somebody twice in one message is one mention of them. The offsets
    // kept are the first, which is where a reader's eye goes.
    if (seen.has(handle)) continue;
    seen.add(handle);
    found.push({
      handle,
      target,
      start: (m.index ?? 0) + m[1].length,
      len: handle.length + 1,
    });
  }

  return found;
}

/**
 * Whether this message opens by addressing a person.
 *
 * This is the escape hatch that keeps Nor out of a conversation he is already a
 * participant in. Once he has been mentioned he answers everything, which is
 * right until you and Jenny start talking to each other — so leading with her
 * name is how you say "this one is not for you", in the same grammar as the rest
 * of the feature rather than in a setting.
 */
export function startsWithHumanMention(
  text: string,
  targets: MentionTarget[]
): boolean {
  const first = parseMentions(text, targets)[0];
  return first != null && first.start === 0 && first.target.kind === "member";
}

/**
 * Whether Nor answers this message.
 *
 * The composer uses this to word its placeholder, and the client alone decides
 * which of the two send paths a message takes. Nothing about that needs
 * defending server-side: the worst a wrong guess produces is a reply nobody
 * wanted, which is a different class of problem from who can read a thread.
 */
export function norWillReply(input: {
  text: string;
  targets: MentionTarget[];
  /** Whether Nor has been mentioned in this thread before. */
  aiParticipant: boolean;
}): boolean {
  const mentions = parseMentions(input.text, input.targets);

  // Naming him is unambiguous and beats everything else here — you cannot type
  // @nor and mean "not you".
  if (mentions.some((m) => m.target.kind === "ai")) return true;

  // Leading with someone's name addresses them, and only them.
  if (startsWithHumanMention(input.text, input.targets)) return false;

  // Mentioning a person mid-sentence is talking ABOUT them, not to them, so it
  // does not on its own send Nor away.
  if (input.aiParticipant) return true;

  // A thread nobody else can see, that has never involved him, is a note to
  // self. Somewhere for a thought to go that isn't a question.
  return false;
}

/** The message as stored, plus who was named in it. */
export type StoredMention = {
  kind: "member" | "ai";
  email: string | null;
  userId: string | null;
  handle: string;
  start: number;
  len: number;
};

export function toStoredMentions(parsed: ParsedMention[]): StoredMention[] {
  return parsed.map((p) => ({
    kind: p.target.kind,
    email: p.target.email,
    userId: p.target.userId,
    handle: p.handle,
    start: p.start,
    len: p.len,
  }));
}
