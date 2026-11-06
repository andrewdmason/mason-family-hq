import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Archive, ArrowLeft } from "lucide-react";
import { TutorMessage } from "@/components/tuttles/tutor-message";
import { createClient } from "@/lib/supabase/server";
import { formatMessageTime, getThread, type ThreadMessage } from "@/lib/tuttles/queries";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The title and the page both need the thread; load it once per request.
const loadThread = cache(async (threadId: string) => {
  if (!UUID.test(threadId)) return null;
  return getThread(await createClient(), threadId);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ threadId: string }>;
}): Promise<Metadata> {
  const { threadId } = await params;
  const thread = await loadThread(threadId);
  return { title: thread?.title ?? "Chat" };
}

/** A new time label when a turn comes more than this long after the last one. */
const TIME_GAP_MS = 60 * 60 * 1000;

/**
 * One kid's chat with the tutor, read-only, laid out like the phone: the kid's
 * messages (and photos) on the right, the tutor's replies on the left with
 * their math and pictures drawn.
 */
export default async function TuttlesThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  const thread = await loadThread(threadId);
  if (!thread) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-6 sm:px-6">
      <div className="mb-4">
        <Link
          href="/tuttles"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Tuttles
        </Link>
      </div>

      <header className="mb-6 border-b border-foreground/10 pb-4">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">{thread.title ?? "New chat"}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>{thread.studentName}</span>
          <span aria-hidden>·</span>
          <span>Started {formatMessageTime(thread.createdAt)}</span>
          {thread.archived && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
              <Archive className="size-3" />
              Archived by {thread.studentName}
            </span>
          )}
        </p>
      </header>

      {thread.messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages in this chat.</p>
      ) : (
        <ol className="space-y-4">
          {thread.messages.map((message, i) => {
            const prev = thread.messages[i - 1];
            const showTime =
              i > 0 && new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() > TIME_GAP_MS;
            return (
              <li key={message.id}>
                {showTime && (
                  <p className="mb-4 mt-6 text-center text-xs text-muted-foreground">
                    {formatMessageTime(message.createdAt)}
                  </p>
                )}
                {message.role === "student" ? <StudentBubble message={message} /> : <TutorReply message={message} />}
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}

function StudentBubble({ message }: { message: ThreadMessage }) {
  return (
    <div className="flex flex-col items-end gap-1.5 pl-10">
      {message.images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {message.images.map((image) => (
            <a
              key={image.path}
              href={image.url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open full size"
              className="block overflow-hidden rounded-xl border border-foreground/10 bg-muted transition-opacity hover:opacity-90"
            >
              {/* Signed, short-lived storage URLs: next/image would cache them past expiry. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt="Homework photo" className="h-28 w-[5.5rem] object-cover object-top" />
            </a>
          ))}
        </div>
      )}
      {message.content.trim() && (
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[1.15rem] rounded-br-md bg-[#d7261e] px-3.5 py-2 text-[0.95rem] leading-snug text-white">
          {message.content}
        </div>
      )}
    </div>
  );
}

function TutorReply({ message }: { message: ThreadMessage }) {
  return (
    <div className="pr-6 text-foreground">
      <TutorMessage content={message.content} id={message.id} />
    </div>
  );
}
