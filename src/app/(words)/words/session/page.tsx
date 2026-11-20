import { redirect } from "next/navigation";
import { SessionRunner } from "@/components/words/session-runner";
import { requireUserId } from "@/lib/members/auth";
import { getProfile, startOrResume } from "@/lib/words/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Session" };

export default async function WordsSessionPage() {
  const userId = await requireUserId();
  const profile = await getProfile(userId);
  if (!profile) redirect("/words");
  const state = await startOrResume(profile);
  return <SessionRunner initial={state} />;
}
