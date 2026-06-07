import { redirect } from "next/navigation";
import { QuestionsEditor } from "@/components/journal/questions-editor";
import { EditingMemberBanner } from "@/components/journal/editing-member-banner";
import { resolveSettingsScope, type SettingsScope } from "@/lib/journal/scope";
import type { JournalQuestionType, JournalSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Question Settings",
};

export default async function QuestionsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  const { member } = await searchParams;
  let scope: SettingsScope;
  try {
    scope = await resolveSettingsScope(member ?? null);
  } catch {
    redirect("/settings/questions");
  }
  const { client, userId, isMemberMode } = scope;

  const [typesRes, settingsRes, memberRes] = await Promise.all([
    client
      .from("journal_question_types")
      .select(
        "id, name, base_description, style_note, weight, enabled, is_builtin, sort_order, recurrence_days, context_spec, created_at, updated_at"
      )
      .eq("user_id", userId)
      .order("sort_order", { ascending: true }),
    client
      .from("journal_settings")
      .select("questions_per_day")
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

  const questionTypes = (typesRes.data ?? []) as JournalQuestionType[];
  const settings: JournalSettings = {
    questions_per_day: settingsRes.data?.questions_per_day ?? 3,
  };

  return (
    <>
      {isMemberMode && (
        <EditingMemberBanner
          memberName={memberRes.data?.name ?? member ?? "this member"}
        />
      )}
      <QuestionsEditor
        questionTypes={questionTypes}
        settings={settings}
        memberEmail={isMemberMode ? member : undefined}
      />
    </>
  );
}
