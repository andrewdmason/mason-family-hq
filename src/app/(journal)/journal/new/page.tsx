import { ChatSurface } from "@/components/journal/chat-surface";
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
  searchParams: Promise<{
    entry?: string;
    start?: string;
    type?: string;
    audience?: string;
  }>;
}) {
  const { entry: entryParam, start, type, audience } = await searchParams;
  // Deep-link from the header's "New ▾" menu into a specific way to start.
  const initialMode =
    start === "freeform" || start === "quote" || start === "recap"
      ? start
      : undefined;
  // Which app launched this compose: the Family app's "New" sets the picker to
  // the family audience (share-friendly questions, visibility pre-set to
  // family); the Journal app's sets it to private. The user can still change it.
  const initialAudience =
    audience === "family" ? "family" : audience === "private" ? "private" : "any";
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
  // picking one inserts the opening message and hands off to the chat. A blank
  // ("write freely") start skips the picker straight into an empty chat surface
  // with question mode off — the writer can turn it on whenever they like.
  const showPicker = messages.length === 0 && !entry.freeform_started_at;

  // The picker shows the page-level gallery above it (photos only, no attach
  // action). The chat flow renders its own gallery inside ChatSurface so the
  // attach action and chat toggle share one hover-revealed row above the title.
  if (showPicker) {
    return (
      <>
        <JournalPhotoGallery
          entryId={entry.id}
          initialPhotos={photos}
          editable
          showAttachAction={false}
        />
        <OpeningPicker
          entryId={entry.id}
          initialCandidates={entry.opening_candidates}
          initialRerollCount={entry.candidates_reroll_count}
          questionTypeNames={questionTypeNames}
          recurringTypeNames={recurringTypeNames}
          initialMode={initialMode}
          initialAudience={initialAudience}
          forcedType={forcedType}
        />
      </>
    );
  }

  return (
    <ChatSurface
      entryId={entry.id}
      initialStatus={entry.status}
      initialVisibility={entry.visibility}
      initialMessages={messages}
      timerStartedAt={timerStartedAt}
      initialQuestionMode={entry.question_mode}
      initialTimerFlippedOff={entry.timer_flipped_off}
      initialTitle={entry.title ?? ""}
      initialDraft={entry.draft_reply ?? ""}
      initialPhotos={photos}
    />
  );
}
