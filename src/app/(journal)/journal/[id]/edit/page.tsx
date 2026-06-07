import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { EntryEditor } from "@/components/journal/entry-editor";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import type { JournalEntry, JournalMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Edit Entry",
};

export default async function EditEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data: entryRow } = await supabase
    .from("journal_entries")
    .select("id, user_id, entry_type, title, entry_date, question_type")
    .eq("id", id)
    .maybeSingle();
  if (!entryRow) notFound();
  const entry = entryRow as JournalEntry;

  // Editing is the author's alone. Quote and recap entries have their own inline
  // editors on the entry page — send those types back there.
  if (entry.user_id !== userId) notFound();
  if (entry.entry_type !== "standard") redirect(`/journal/${id}`);

  const { data: msgs } = await supabase
    .from("journal_messages")
    .select("id, entry_id, role, content, created_at")
    .eq("entry_id", id)
    .order("created_at", { ascending: true });

  const messages = ((msgs ?? []) as JournalMessage[]).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
  }));

  // Categories to offer in the editor: the user's enabled question types, plus
  // the entry's current category if it happens to be a disabled/removed one (so
  // editing never silently drops a tag it can't re-offer).
  const { data: typeRows } = await supabase
    .from("journal_question_types")
    .select("name, enabled, sort_order")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true });
  const questionTypeOptions = ((typeRows ?? []) as {
    name: string;
    enabled: boolean;
  }[])
    .filter((t) => t.enabled || t.name === entry.question_type)
    .map((t) => t.name);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-2xl px-6 pb-24 pt-8">
        <Link
          href={`/journal/${id}`}
          className="font-serif text-xs text-muted-foreground hover:text-foreground"
        >
          ← post
        </Link>
        <p className="mt-6 font-serif text-sm text-muted-foreground tabular-nums">
          {formatDate(entry.entry_date)}
        </p>
        <EntryEditor
          entryId={id}
          initialTitle={entry.title?.trim() ?? ""}
          initialQuestionType={entry.question_type ?? ""}
          questionTypeOptions={questionTypeOptions}
          messages={messages}
        />
      </div>
    </div>
  );
}

function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
