import "server-only";

import { NextResponse } from "next/server";
import { tuttlesCaller } from "@/lib/tuttles/context";
import { getProfile, type Profile } from "@/lib/words/session";

// Vocab in the Tuttles app: the ISEE vocabulary practice of /words
// (src/lib/words), played natively. The routes under /tuttles/api/vocab are
// the website's own actions (src/app/(words)/words/actions.ts) for a phone,
// which sends its access token instead of cookies.

export type VocabCaller =
  /** A parent in the parents' own view: both kids, read-only. */
  | { parentView: true; userId: string }
  /**
   * A kid, or a parent's phone being used as one (the app's account picker).
   * Like a chat, the practice is then the kid's own: it's their level, their
   * session and their progress, whoever is holding the phone.
   */
  | { parentView: false; userId: string; name: string; profile: Profile | null };

export async function vocabCaller(request: Request): Promise<VocabCaller | { error: string; status: number }> {
  const caller = await tuttlesCaller(request);
  if ("error" in caller) return caller;
  const { student } = caller;
  if (student.preview) return { parentView: true, userId: student.ownerId };
  return { parentView: false, userId: student.ownerId, name: student.name, profile: await getProfile(student.ownerId) };
}

/** The kid whose session this is, or the response that says why there isn't one. */
export async function vocabPlayer(request: Request): Promise<{ userId: string; profile: Profile } | NextResponse> {
  const caller = await vocabCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  if (caller.parentView || !caller.profile) return NextResponse.json({ error: "Vocab isn't set up for you yet." }, { status: 403 });
  return { userId: caller.userId, profile: caller.profile };
}

export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const NO_STORE = { headers: { "Cache-Control": "no-store" } };
