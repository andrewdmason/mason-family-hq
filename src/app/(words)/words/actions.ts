"use server";

import { revalidatePath } from "next/cache";
import { getIsAdult, requireUserId } from "@/lib/members/auth";
import { answerQuestion, getProfile, setProfile, startOrResume } from "@/lib/words/session";
import type { Feedback, Level, SessionState } from "@/lib/words/types";

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

/** A parent trying it for themselves picks which test to practise. The kids' levels are set for them. */
export async function chooseLevel(level: Level): Promise<void> {
  const userId = await requireUserId();
  if (!(await getIsAdult())) throw new Error("Not authorized");
  if (level !== "lower" && level !== "middle") throw new Error("Unknown level");
  await setProfile(userId, level);
  revalidatePath("/words");
}
