import { SessionList } from "@/components/practice/session-list";

export const metadata = {
  title: "Sessions",
};

/**
 * Full open-session list (plan U8/R18). The Listen page retired; recording a
 * new session (and the "process an existing audio file" escape hatch) lives
 * in the Recordings page's Sessions section — this page is the browsing
 * surface for everything ever captured. /practice/session/[id] stays the
 * per-session detail (playback, MIDI debug view, linking).
 */
export default function SessionsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Sessions</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Open practice sessions — recorded without a task, kept with audio and
        MIDI. Record new ones from the Recordings page.
      </p>
      <SessionList limit={50} />
    </div>
  );
}
