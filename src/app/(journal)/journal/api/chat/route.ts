import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import {
  buildSystemPrompt,
  loadAgentFiles,
  loadTimelineBlock,
  loadFamilyDoc,
  loadHistory,
  messagesAsAnthropicTurns,
} from "@/lib/journal/context";
import { loadCalendarBlock } from "@/lib/journal/calendar";
import { requireUserId } from "@/lib/members/auth";
import { formatNow, getUserTimezone, localDate } from "@/lib/date-utils";
import type { JournalMessage } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { entryId: string; userMessage?: string };
  const { entryId, userMessage } = body;
  if (!entryId) {
    return new Response("entryId required", { status: 400 });
  }
  if (!userMessage || userMessage.trim().length === 0) {
    return new Response("userMessage required", { status: 400 });
  }

  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  // Confirm entry exists & is open
  const { data: entry, error: entryErr } = await supabase
    .from("journal_entries")
    .select("id, entry_date, status, opening_question")
    .eq("id", entryId)
    .single();
  if (entryErr || !entry) {
    return new Response("entry not found", { status: 404 });
  }
  if (entry.status !== "open") {
    return new Response("entry is closed; reopen first", { status: 409 });
  }

  // Load full message thread so far (in order)
  const { data: existingMsgs, error: msgsErr } = await supabase
    .from("journal_messages")
    .select("id, entry_id, role, content, created_at")
    .eq("entry_id", entryId)
    .order("created_at", { ascending: true });
  if (msgsErr) {
    return new Response(msgsErr.message, { status: 500 });
  }
  const thread = (existingMsgs ?? []) as JournalMessage[];

  // Persist the user's reply before generating the follow-up.
  {
    const { data: inserted, error: insertErr } = await supabase
      .from("journal_messages")
      .insert({ entry_id: entryId, role: "user", content: userMessage.trim(), user_id: userId })
      .select("id, entry_id, role, content, created_at")
      .single();
    if (insertErr || !inserted) {
      return new Response(insertErr?.message ?? "failed to save user message", {
        status: 500,
      });
    }
    thread.push(inserted as JournalMessage);
  }

  // Assemble system prompt
  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);
  const [files, history, calendarBlock, familyDoc, timelineBlock] = await Promise.all([
    loadAgentFiles(),
    loadHistory(today, entryId),
    loadCalendarBlock(today, tz),
    loadFamilyDoc(),
    loadTimelineBlock(today),
  ]);
  const system = buildSystemPrompt(
    files,
    history,
    today,
    calendarBlock,
    formatNow(new Date(), tz),
    familyDoc,
    timelineBlock
  );

  const turns = messagesAsAnthropicTurns(thread);

  const client = anthropic();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let full = "";
      try {
        const claudeStream = client.messages.stream({
          model: JOURNAL_MODEL,
          max_tokens: 1024,
          system,
          messages: turns,
        });

        for await (const event of claudeStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const chunk = event.delta.text;
            full += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
        }

        // Persist assistant message
        const trimmed = full.trim();
        if (trimmed.length > 0) {
          await supabase
            .from("journal_messages")
            .insert({ entry_id: entryId, role: "assistant", content: trimmed, user_id: userId });
        }

        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`\n\n[error: ${msg}]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
