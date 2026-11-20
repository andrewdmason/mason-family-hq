"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/members/auth";
import { answerQuestion, getProfile, removeCurrent, setItemRemoved, startOrResume } from "@/lib/words/session";
import type { Feedback, SessionState } from "@/lib/words/types";

/** Today's session: the one under way, or a new one. */
export async function beginSession(): Promise<SessionState | null> {
  const userId = await requireUserId();
  const profile = await getProfile(userId);
  if (!profile) return null;
  return startOrResume(profile);
}

/** Answer the question on screen. `choice` is null for "Don't know". */
export async function submitAnswer(
  sessionId: string,
  position: number,
  choice: number | null,
  ms: number
): Promise<{ feedback: Feedback; state: SessionState } | null> {
  const userId = await requireUserId();
  const result = await answerQuestion(userId, sessionId, position, choice, ms);
  if (result?.state.summary) revalidatePath("/words");
  return result;
}

/** Take the word on screen out for good and get another in its place. */
export async function removeFromSession(sessionId: string, position: number, ms: number): Promise<SessionState | null> {
  const userId = await requireUserId();
  const state = await removeCurrent(userId, sessionId, position, ms);
  if (state?.summary) revalidatePath("/words");
  return state;
}

/** From the list: remove one of your own words, or bring a removed one back. */
export async function setRemoved(itemId: string, removed: boolean): Promise<void> {
  const userId = await requireUserId();
  const profile = await getProfile(userId);
  if (!profile) return;
  await setItemRemoved(profile, itemId, removed);
  revalidatePath("/words");
  revalidatePath("/words/list");
}
