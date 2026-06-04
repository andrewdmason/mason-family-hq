import { ChatSurface } from "@/components/journal/chat-surface";
import { FreeformComposer } from "@/components/journal/freeform-composer";
import { OpeningPicker } from "@/components/journal/opening-picker";
import { JournalPhotoGallery } from "@/components/journal/journal-photo-gallery";
import { createClient } from "@/lib/supabase/server";
import {
  getEntryById,
  getEntryPhotos,
  getOrCreateTodayEntry,
} from "@/app/(journal)/journal/actions";
import type { JournalMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ entry?: string; start?: string; type?: string }>;
}) {
  const { entry: entryParam, start, type } = await searchParams;
  // Deep-link from the header's "New ▾" menu into a specific way to start.
  const initialMode =
    start === "freeform" || start === "quote" || start === "recap"
      ? start
      : undefined;
  const entry = entryParam
    ? await getEntryById(entryParam)
    : await getOrCreateTodayEntry();

  const supabase = await createClient();
  const { data: msgs } = await supabase
    .from("journal_messages")
    .select("id, entry_id, role, content, created_at")
    .eq("entry_id", entry.id)
    .order("created_at", { ascending: true });

  // All question types (incl. disabled) power the "ask about something
  // specific" menu in the picker; recurring ones also get their own trigger.
  const { data: typeRows } = await supabase
    .from("journal_question_types")
    .select("name, recurrence_days")
    .order("sort_order", { ascending: true });
  const questionTypeNames = (typeRows ?? []).map((t) => t.name as string);
  const recurringTypeNames = (typeRows ?? [])
    .filter((t) => t.recurrence_days != null)
    .map((t) => t.name as string);

  // Deep-link from a recurring post's "due" notification (/journal/new?type=…):
  // force the picker straight into that type. Ignore an unknown type so a stale
  // link just falls back to the normal picker.
  const forcedType =
    type && questionTypeNames.includes(type) ? type : undefined;

  const messageRows = (msgs ?? []) as JournalMessage[];
  const messages = messageRows.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // The zen timer is anchored to a wall-clock timestamp so its completion
  // persists across refreshes and reopens. A freeform entry has no opening
  // message, so it anchors to when "write freely" was clicked; a picked
  // question anchors to the opening question's timestamp.
  const timerStartedAt =
    entry.freeform_started_at ?? messageRows[0]?.created_at ?? null;

  const photos = await getEntryPhotos(entry.id);

  // A fresh open entry with no messages starts in the three-question picker;
  // picking one inserts the opening message and hands off to the chat. Once
  // "write freely" is clicked the picker is bypassed straight to the freeform
  // blog composer; picking a question hands off to the AI-interview chat.
  const showPicker = messages.length === 0 && !entry.freeform_started_at;
  const isFreeform = !showPicker && Boolean(entry.freeform_started_at);

  // The freeform composer renders and positions its own photos inline (a blog
  // post, not a floating attach action), so the page-level gallery is only for
  // the picker and the AI-interview chat.
  if (isFreeform) {
    const body =
      messageRows.find((m) => m.role === "user")?.content ?? "";
    return (
      <FreeformComposer
        entryId={entry.id}
        initialTitle={entry.title ?? ""}
        initialBody={body}
        initialVisibility={entry.visibility}
        initialPhotos={photos}
      />
    );
  }

  return (
    <>
      <JournalPhotoGallery
        entryId={entry.id}
        initialPhotos={photos}
        editable
        showAttachAction={!showPicker}
      />
      {showPicker ? (
        <OpeningPicker
          entryId={entry.id}
          initialCandidates={entry.opening_candidates}
          initialRerollCount={entry.candidates_reroll_count}
          questionTypeNames={questionTypeNames}
          recurringTypeNames={recurringTypeNames}
          initialMode={initialMode}
          forcedType={forcedType}
        />
      ) : (
        <ChatSurface
          entryId={entry.id}
          initialStatus={entry.status}
          initialVisibility={entry.visibility}
          initialMessages={messages}
          timerStartedAt={timerStartedAt}
        />
      )}
    </>
  );
}
