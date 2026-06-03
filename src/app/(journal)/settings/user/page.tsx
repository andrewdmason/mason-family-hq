import { redirect } from "next/navigation";
import { SingleFileEditor } from "@/components/journal/agent-file-editor";
import { UserDocPrompt } from "@/components/journal/user-doc-prompt";
import { InterviewerAgeSelector } from "@/components/journal/interviewer-age-selector";
import { EditingMemberBanner } from "@/components/journal/editing-member-banner";
import { loadFamilyDoc } from "@/lib/journal/context";
import { resolveSettingsScope, type SettingsScope } from "@/lib/journal/scope";
import { buildUserDocPrompt } from "@/lib/journal/seeds/user-doc-prompt";
import { buildPastDocPrompt } from "@/lib/journal/seeds/past-doc-prompt";
import { matchTemplateId } from "@/lib/journal/seeds/interviewer-templates";

export const dynamic = "force-dynamic";

export default async function UserSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  const { member } = await searchParams;
  let scope: SettingsScope;
  try {
    scope = await resolveSettingsScope(member ?? null);
  } catch {
    redirect("/settings/user");
  }
  const { client, userId, isMemberMode } = scope;

  const [presentRes, pastRes, interviewerRes, familyDoc, memberRes] =
    await Promise.all([
      client
        .from("journal_agent_files")
        .select("content")
        .eq("name", "Present")
        .eq("user_id", userId)
        .maybeSingle(),
      client
        .from("journal_agent_files")
        .select("content")
        .eq("name", "Past")
        .eq("user_id", userId)
        .maybeSingle(),
      client
        .from("journal_agent_files")
        .select("content")
        .eq("name", "Interviewer")
        .eq("user_id", userId)
        .maybeSingle(),
      loadFamilyDoc(),
      client
        .from("family_members")
        .select("name")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

  const ageId = matchTemplateId(interviewerRes.data?.content ?? "");
  const memberName = memberRes.data?.name ?? null;
  const presentPrompt = buildUserDocPrompt({ familyDoc, memberName, ageId });
  const pastPrompt = buildPastDocPrompt({ familyDoc, memberName, ageId });

  return (
    <>
      {isMemberMode && (
        <EditingMemberBanner memberName={memberName ?? member ?? "this member"} />
      )}

      <InterviewerAgeSelector
        interviewerContent={interviewerRes.data?.content ?? ""}
        memberEmail={isMemberMode ? member : undefined}
      />

      <section className="mt-6">
        <h2 className="font-serif text-lg text-foreground">Present</h2>
        <p className="mt-1 font-serif text-xs italic text-muted-foreground">
          Who you are now — your current life, the people around you, and what
          you&apos;re working on.
        </p>
        <UserDocPrompt prompt={presentPrompt} result="profile" />
        <SingleFileEditor
          target={{ kind: "agent", name: "Present" }}
          initialMarkdown={presentRes.data?.content ?? ""}
          memberEmail={isMemberMode ? member : undefined}
        />
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-lg text-foreground">Past</h2>
        <p className="mt-1 font-serif text-xs italic text-muted-foreground">
          Your life story — where you come from, how you grew up, and the
          memories worth coming back to.
        </p>
        <UserDocPrompt prompt={pastPrompt} result="life story" />
        <SingleFileEditor
          target={{ kind: "agent", name: "Past" }}
          initialMarkdown={pastRes.data?.content ?? ""}
          memberEmail={isMemberMode ? member : undefined}
        />
      </section>
    </>
  );
}
