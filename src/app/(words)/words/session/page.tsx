import { redirect } from "next/navigation";
import { SessionRunner } from "@/components/words/session-runner";
import { getIsAdult, requireUserId } from "@/lib/members/auth";
import { getProfile, setProfile, startOrResume } from "@/lib/words/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Session" };

export default async function WordsSessionPage({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const userId = await requireUserId();
  const { level } = await searchParams;
  // A parent playing from one of the kids' pages practises at that kid's level,
  // under their own name. The kids' levels are set for them.
  let profile = await getProfile(userId);
  if ((level === "lower" || level === "middle") && profile?.level !== level && (await getIsAdult())) {
    profile = await setProfile(userId, level);
  }
  if (!profile) redirect("/words");
  const state = await startOrResume(profile);
  return <SessionRunner initial={state} />;
}
