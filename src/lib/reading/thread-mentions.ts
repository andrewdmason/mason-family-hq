import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listRoster } from "@/lib/members/roster";
import { ensurePlacement } from "@/lib/reading/share-placement";
import {
  mentionTargets,
  parseMentions,
  toStoredMentions,
  type StoredMention,
} from "@/lib/reading/mentions";

/**
 * Read a message for who it names, and make that mean something.
 *
 * Called from both write paths — the plain save and the streaming answer —
 * because they are the same act as far as the people in the room are concerned,
 * and a rule that only holds on one of them is worse than no rule.
 *
 * The parse happens here, from the text, and never from a mentions array the
 * client sent. The client parses too, but only to draw a menu and highlight what
 * you typed; a recipient list arriving over the wire is somebody else's grant
 * written in your name.
 */
export async function recordMentions(
  client: SupabaseClient,
  input: {
    threadId: string;
    text: string;
    authorId: string;
    /**
     * Whether the caller is acting AS somebody else — a parent administering a
     * kid's shelf. Mentions are refused in that mode: posting into a shared
     * conversation in a third party's name, with an audience, is impersonation,
     * and it is a whole class of question worth simply not opening. Costs
     * nothing today, since the reader is always self-scoped.
     */
    isMemberMode: boolean;
  }
): Promise<StoredMention[]> {
  if (input.isMemberMode) return [];
  const roster = await listRoster();
  const targets = mentionTargets(roster);
  const parsed = parseMentions(input.text, targets);

  // Nothing here puts Nor in the room. Whether he is in a thread is decided
  // when it is started (Ask or Note) and recorded by the chat route the first
  // time he answers — see createAnnotation and the route's thread update.
  const people = parsed
    .map((p) => p.target)
    .filter((t) => t.kind === "member" && t.userId != null);

  for (const person of people) {
    await grantAccess({
      threadId: input.threadId,
      userId: person.userId as string,
      invitedBy: input.authorId,
    });
  }

  // Always, not only when somebody was named. A reply in a conversation two
  // people are having is exactly the thing the other one wants to hear about,
  // and requiring them to be re-named every turn is the tax this whole design
  // exists to remove.
  await notifyThread({
    threadId: input.threadId,
    actorId: input.authorId,
    mentionedUserIds: people.map((p) => p.userId as string),
  });

  return toStoredMentions(parsed);
}

/**
 * Put a line in the outbox for everybody in this conversation except whoever
 * just spoke.
 *
 * Two kinds and they read differently in an inbox: being brought into something
 * ("Andrew left you a note in Middlemarch") and something you are already in
 * carrying on ("Jenny replied"). Whether either is actually sent is decided
 * later, by the sweep, which is also where the decision not to email somebody
 * who already read it in the app lives.
 */
async function notifyThread(input: {
  threadId: string;
  actorId: string;
  mentionedUserIds: string[];
}): Promise<void> {
  const admin = createAdminClient();

  const { data: roster } = await admin
    .from("reading_annotation_thread_participants")
    .select("user_id")
    .eq("thread_id", input.threadId)
    .eq("muted", false)
    .neq("user_id", input.actorId);

  const recipients = ((roster ?? []) as { user_id: string }[]).map(
    (r) => r.user_id
  );
  if (recipients.length === 0) return;

  await admin.from("reading_annotation_notifications").insert(
    recipients.map((userId) => ({
      thread_id: input.threadId,
      recipient_user_id: userId,
      actor_user_id: input.actorId,
      kind: input.mentionedUserIds.includes(userId) ? "mention" : "reply",
    }))
  );
}

/**
 * Let somebody into a conversation.
 *
 * The grant lands immediately and the WORK lands afterwards. Putting the book on
 * their shelf means copying a file, a page map and a conversion; making the
 * mention wait for that would leave the reader watching a spinner after typing a
 * name. So the participant row goes in now — that alone is what decides who can
 * read the thread — and the mark it points at is placed behind the response.
 *
 * A participant row with no mark attached is a legitimate state, not a broken
 * one, and three separate things heal it: this, the permalink, and the panel.
 */
async function grantAccess(input: {
  threadId: string;
  userId: string;
  invitedBy: string;
}): Promise<void> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("reading_annotation_thread_participants")
    .select("user_id")
    .eq("thread_id", input.threadId)
    .eq("user_id", input.userId)
    .maybeSingle();
  // Already in. Naming somebody again is a way of addressing them, not a second
  // invitation, and re-granting would reset the invitation it came from.
  if (existing) return;

  const { error } = await admin
    .from("reading_annotation_thread_participants")
    .insert({
      thread_id: input.threadId,
      user_id: input.userId,
      role: "participant",
      invited_by: input.invitedBy,
    });
  // 23505 is the same person being named twice in a breath by two devices.
  if (error && error.code !== "23505") throw new Error(error.message);

  const place = async () => {
    try {
      await ensurePlacement({ threadId: input.threadId, userId: input.userId });
    } catch {
      // The link and the panel both heal this. A share that failed to place is
      // recoverable; a share that failed to GRANT would not be, and that part
      // already happened above.
    }
  };

  try {
    // Behind the response in the normal case, so typing a name doesn't leave the
    // reader watching a file get copied.
    after(place);
  } catch {
    // `after` only exists inside a request. A script or a job calling this does
    // the work inline instead of losing it — and losing it here would mean a
    // grant with nothing to look at, which is the one outcome worth avoiding.
    await place();
  }
}
