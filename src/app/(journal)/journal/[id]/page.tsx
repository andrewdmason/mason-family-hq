import { notFound } from "next/navigation";
import Link from "next/link";
import { ChatSurface } from "@/components/journal/chat-surface";
import { CommentableEntry } from "@/components/journal/commentable-entry";
import { EntryByline } from "@/components/journal/entry-byline";
import { EntryOwnerMenuItems } from "@/components/journal/entry-owner-menu-items";
import { EntryTitle } from "@/components/journal/entry-title";
import { QuoteEntryView } from "@/components/journal/quote-entry-view";
import { RecapEntryView } from "@/components/journal/recap-entry-view";
import { JournalPhotoGallery } from "@/components/journal/journal-photo-gallery";
import { MarkEntryViewed } from "@/components/journal/mark-entry-viewed";
import { createClient } from "@/lib/supabase/server";
import { getIsOwner, requireUserId } from "@/lib/members/auth";
import { getEntryBlocks } from "@/lib/journal/entry-blocks";
import {
  getEntriesImageGenerationStates,
  getEntryPhotos,
} from "@/app/(journal)/journal/actions";
import type {
  JournalEntry,
  JournalInlineComment,
  JournalInlineCommentWithAuthor,
  JournalMessage,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Journal Entry",
};

export default async function EntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data: entryRow } = await supabase
    .from("journal_entries")
    .select(
      "id, entry_date, user_id, status, entry_type, visibility, opening_question, freeform_started_at, question_mode, timer_flipped_off, draft_reply, summary, title, pull_quote, quote_attribution, recap_body, summary_stale, closed_at, created_at, updated_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!entryRow) notFound();
  const entry = entryRow as JournalEntry;

  // You control your own posts; the account owner can additionally manage
  // photos on anyone's post (acting on the author's behalf) and moderate
  // comments. A non-owner family member viewing someone else's shared entry
  // sees the post read-only, but can comment on it. The author's display name
  // is always resolved now, since family posts show a byline even on your own.
  const isAuthor = entry.user_id === userId;
  const isOwner = await getIsOwner(supabase);
  const canManagePhotos = isAuthor || isOwner;
  const { data: authorMember } = await supabase
    .from("family_members")
    .select("name, email")
    .eq("user_id", entry.user_id)
    .maybeSingle();
  const authorName =
    authorMember?.name?.trim() ||
    (authorMember?.email as string | undefined) ||
    "A family member";

  const { data: msgs } = await supabase
    .from("journal_messages")
    .select("id, entry_id, role, content, created_at")
    .eq("entry_id", entry.id)
    .order("created_at", { ascending: true });

  const messages = ((msgs ?? []) as JournalMessage[]).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Comments live on finished, shared posts only. Fetch them, resolve each
  // commenter's name in one batched lookup, and group for the renderer.
  const isFamily = entry.visibility === "family";
  const commentsEnabled = isFamily && entry.status === "closed";
  let comments: JournalInlineCommentWithAuthor[] = [];
  if (commentsEnabled) {
    const { data: commentRows } = await supabase
      .from("journal_inline_comments")
      .select(
        "id, entry_id, user_id, block_index, content, created_at, updated_at"
      )
      .eq("entry_id", entry.id)
      .order("created_at", { ascending: true });
    const rows = (commentRows ?? []) as JournalInlineComment[];
    const commenterIds = [...new Set(rows.map((r) => r.user_id))];
    const nameByUser = new Map<string, string>();
    if (commenterIds.length > 0) {
      const { data: members } = await supabase
        .from("family_members")
        .select("user_id, name, email")
        .in("user_id", commenterIds);
      for (const m of members ?? []) {
        nameByUser.set(
          m.user_id as string,
          (m.name as string | null)?.trim() ||
            (m.email as string | undefined) ||
            "A family member"
        );
      }
    }
    comments = rows.map((r) => ({
      ...r,
      authorName: nameByUser.get(r.user_id) ?? "A family member",
    }));
  }

  // Distinct commenters for the byline, excluding the author, in the order they
  // first commented.
  const commenterNames: string[] = [];
  const seenCommenters = new Set<string>();
  for (const c of comments) {
    if (c.user_id === entry.user_id || seenCommenters.has(c.user_id)) continue;
    seenCommenters.add(c.user_id);
    commenterNames.push(c.authorName);
  }

  const blocks = getEntryBlocks({
    entryType: entry.entry_type,
    messages,
    pullQuote: entry.pull_quote,
    recapBody: entry.recap_body,
  });

  const [photos, imageGenerationByEntry] = await Promise.all([
    getEntryPhotos(entry.id),
    getEntriesImageGenerationStates([entry.id]),
  ]);
  const photoGenerationStatus = imageGenerationByEntry[entry.id] ?? null;
  const isQuote = entry.entry_type === "quote";
  const isRecap = entry.entry_type === "recap";
  const menuActions = canManagePhotos ? (
    <EntryOwnerMenuItems
      entryId={entry.id}
      initialVisibility={entry.visibility}
      canChangeVisibility={isAuthor}
    />
  ) : null;
  const mediaViewer = (
    <JournalPhotoGallery
      entryId={entry.id}
      initialPhotos={photos}
      editable={canManagePhotos}
      showAttachAction={false}
      photoGenerationStatus={photoGenerationStatus}
      containerClassName="pt-6"
    />
  );

  return (
    <div className="flex flex-1 flex-col">
      {commentsEnabled && <MarkEntryViewed entryId={entry.id} />}
      <div className="mx-auto w-full max-w-2xl px-6 pt-8">
        <Link
          href={isFamily ? "/family" : "/journal"}
          className="font-serif text-xs text-muted-foreground hover:text-foreground"
        >
          {isFamily ? "← family" : "← journal"}
        </Link>
        <div className="mt-6 flex items-baseline gap-3">
          <p className="font-serif text-sm text-muted-foreground tabular-nums">
            {formatDate(entry.entry_date)}
          </p>
          {isFamily && (
            <EntryByline authorName={authorName} commenterNames={commenterNames} />
          )}
        </div>
        {isQuote ? (
          <QuoteEntryView
            entryId={entry.id}
            quote={entry.pull_quote ?? ""}
            attribution={entry.quote_attribution}
            readOnly={!isAuthor}
            afterTitle={mediaViewer}
            menuActions={menuActions}
          />
        ) : isRecap ? (
          <RecapEntryView
            entryId={entry.id}
            title={entry.title?.trim() || "Untitled"}
            body={entry.recap_body ?? ""}
            readOnly={!isAuthor}
            afterTitle={mediaViewer}
            menuActions={menuActions}
          />
        ) : (
          <EntryTitle
            entryId={entry.id}
            title={entry.title?.trim() || "Untitled"}
            readOnly={!isAuthor}
            afterTitle={mediaViewer}
            menuActions={menuActions}
          />
        )}
        {/* Quote and recap bodies render above; the comment layer hangs beneath
            them, anchored to the single block. */}
        {commentsEnabled && (isQuote || isRecap) && (
          <div className="mt-6">
            <CommentableEntry
              entryId={entry.id}
              blocks={blocks}
              initialComments={comments}
              currentUserId={userId}
              isOwner={isOwner}
              renderBlockContent={false}
            />
          </div>
        )}
      </div>
      {/* Only standard entries have a conversation — no transcript or reply
          box for quote and recap entries. A finished, shared standard entry
          renders through the comment-aware view; otherwise it's the plain
          transcript (and, while open, the writing surface). */}
      {entry.entry_type === "standard" &&
        (commentsEnabled ? (
          <div className="mx-auto w-full max-w-2xl px-6 pb-24 pt-12">
            <CommentableEntry
              entryId={entry.id}
              blocks={blocks}
              initialComments={comments}
              currentUserId={userId}
              isOwner={isOwner}
            />
          </div>
        ) : (
          <ChatSurface
            entryId={entry.id}
            initialStatus={entry.status}
            initialVisibility={entry.visibility}
            initialMessages={messages}
            viewMode="history"
            timerStartedAt={
              entry.freeform_started_at ?? msgs?.[0]?.created_at ?? null
            }
            initialQuestionMode={entry.question_mode}
            initialTimerFlippedOff={entry.timer_flipped_off}
            initialDraft={entry.draft_reply ?? ""}
            readOnly={!isAuthor}
          />
        ))}
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
