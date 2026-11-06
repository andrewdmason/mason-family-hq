import Link from "next/link";
import { Archive, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatActivity, getThreadsByStudent } from "@/lib/tuttles/queries";
import { CANVAS_BASE_URL, getCanvasStatuses } from "@/lib/canvas/connections";
import { CanvasConnections } from "@/components/tuttles/canvas-connections";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
// Connecting a Canvas key syncs the kid's coursework before the action returns.
export const maxDuration = 120;

/**
 * The parents' view of Tuttles: every kid's tutor chats, newest first, grouped
 * by kid. Read-only — the kids chat on the iPhone app. Archived chats stay
 * listed (a kid can tidy their own list, not hide a chat from a parent).
 */
export default async function TuttlesPage() {
  const supabase = await createClient();
  const [students, canvas] = await Promise.all([getThreadsByStudent(supabase), getCanvasStatuses()]);
  const now = new Date();

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 pb-24 pt-10">
      <header className="mb-8">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">Tuttles</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The kids’ homework chats with their tutor.
        </p>
      </header>

      <CanvasConnections statuses={canvas} canvasUrl={CANVAS_BASE_URL} now={now.getTime()} />

      {students.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No chats yet. Chats from the Tuttles iPhone app show up here.
        </p>
      ) : (
        <div className="space-y-8">
          {students.map((student) => (
            <section key={student.studentId}>
              <h2 className="mb-2 flex items-baseline gap-2 px-1">
                <span className="font-serif text-lg text-foreground">{student.name}</span>
                <span className="text-xs text-muted-foreground">
                  {student.threads.length} {student.threads.length === 1 ? "chat" : "chats"}
                </span>
              </h2>
              <ul className="divide-y divide-foreground/8 overflow-hidden rounded-xl border border-foreground/10 bg-card">
                {student.threads.map((thread) => (
                  <li key={thread.id}>
                    <Link
                      href={`/tuttles/${thread.id}`}
                      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-foreground/[0.03]"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          thread.archived ? "bg-foreground/15" : "bg-[#d7261e]"
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-[0.95rem] text-foreground",
                            thread.untitled && "text-foreground/80 italic",
                            thread.archived && "text-muted-foreground"
                          )}
                        >
                          {thread.title}
                        </span>
                        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>
                            {thread.messageCount} {thread.messageCount === 1 ? "message" : "messages"}
                          </span>
                          {thread.archived && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[11px]">
                              <Archive className="size-3" />
                              Archived
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatActivity(thread.updatedAt, now)}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
