import { redirect } from "next/navigation";
import { SingleFileEditor } from "@/components/journal/agent-file-editor";
import { EditingMemberBanner } from "@/components/journal/editing-member-banner";
import { resolveSettingsScope, type SettingsScope } from "@/lib/journal/scope";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Interviewer Settings",
};

export default async function InterviewerSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  const { member } = await searchParams;
  let scope: SettingsScope;
  try {
    scope = await resolveSettingsScope(member ?? null);
  } catch {
    redirect("/settings/interviewer");
  }
  const { client, userId, isMemberMode } = scope;

  const [{ data }, memberRes] = await Promise.all([
    client
      .from("journal_agent_files")
      .select("content")
      .eq("name", "Interviewer")
      .eq("user_id", userId)
      .maybeSingle(),
    isMemberMode
      ? client
          .from("family_members")
          .select("name")
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <>
      {isMemberMode && (
        <EditingMemberBanner
          memberName={memberRes.data?.name ?? member ?? "this member"}
        />
      )}
      <SingleFileEditor
        target={{ kind: "agent", name: "Interviewer" }}
        initialMarkdown={data?.content ?? ""}
        memberEmail={isMemberMode ? member : undefined}
      />
    </>
  );
}
