import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SessionRowActions } from "@/components/practice/session-row-actions";
import type {
  PracticeSessionLinkStatus,
  PracticeSessionStatus,
} from "@/lib/types";

type Row = {
  id: string;
  date: string;
  status: PracticeSessionStatus;
  link_status: PracticeSessionLinkStatus;
  recording_path: string | null;
  created_at: string;
};

function statusLabel(s: Row): string {
  if (s.status === "uploaded") return "queued";
  if (s.status === "processing") return "processing…";
  if (s.status === "failed") return "failed";
  if (s.link_status === "linking") return "linking…";
  if (s.link_status === "linked") return "ready · linked";
  return "ready";
}

/**
 * Open-session list (plan U8): the browsing surface that replaced the Listen
 * page. Rows show transcription/link status, play back kept audio once ready,
 * and link through to the session detail page (playback + MIDI + linking).
 * Server component — mount under any page (Recordings' Sessions section,
 * /practice/session).
 */
export async function SessionList({ limit = 10 }: { limit?: number }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("practice_sessions")
    .select("id, date, status, link_status, recording_path, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  const sessions = (data ?? []) as Row[];

  if (!sessions.length) {
    return <p className="text-sm text-muted-foreground">No sessions yet.</p>;
  }

  return (
    <div className="divide-y rounded-lg border">
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
          <Link
            href={`/practice/session/${s.id}`}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 hover:text-foreground"
          >
            <span>{s.date}</span>
            <span
              className={
                s.status === "failed"
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {statusLabel(s)}
            </span>
          </Link>
          <SessionRowActions
            sessionId={s.id}
            status={s.status}
            recordingPath={s.recording_path}
          />
          <Link
            href={`/practice/session/${s.id}`}
            aria-label="Open session"
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronRightIcon className="size-3.5" />
          </Link>
        </div>
      ))}
    </div>
  );
}
