import { redirect } from "next/navigation";
import { FamilyManager } from "@/components/journal/family-manager";
import { SingleFileEditor } from "@/components/journal/agent-file-editor";
import { getIsOwner } from "@/lib/journal/auth";
import { loadFamilyDoc } from "@/lib/journal/context";
import {
  getFamilyJournalStats,
  getMemberPhotos,
  getReadingGoals,
  listFamilyMembers,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function FamilySettingsPage() {
  // Owner-only. Non-owners are bounced to the first settings tab.
  if (!(await getIsOwner())) {
    redirect("/settings/user");
  }

  const [members, familyDoc, photosByEmail, journalStatsByUserId, readingGoalsByEmail] =
    await Promise.all([
      listFamilyMembers(),
      loadFamilyDoc(),
      getMemberPhotos(),
      getFamilyJournalStats(),
      getReadingGoals(),
    ]);
  return (
    <>
      <FamilyManager
        members={members}
        photosByEmail={photosByEmail}
        journalStatsByUserId={journalStatsByUserId}
        readingGoalsByEmail={readingGoalsByEmail}
      />
      <div className="mt-10 border-t border-border pt-6">
        <h3 className="font-serif text-xs uppercase tracking-wide text-muted-foreground">
          Family context
        </h3>
        <p className="mt-1 font-serif text-xs italic text-muted-foreground">
          Shared notes about your family — who everyone is, ages, anything worth
          knowing. Every member&apos;s interviewer reads this, and it seeds the
          &ldquo;build your profile&rdquo; prompt. Only you can edit it.
        </p>
        <SingleFileEditor target={{ kind: "family" }} initialMarkdown={familyDoc} />
      </div>
    </>
  );
}
