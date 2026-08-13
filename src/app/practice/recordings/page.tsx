import Link from "next/link";
import { RecordingsList } from "@/components/recordings/recordings-list";
import { SessionRecorder } from "@/components/practice/session-recorder";
import { SessionList } from "@/components/practice/session-list";
import { getRecordings } from "./actions";

export const metadata = {
  title: "Recordings",
};

export default async function RecordingsPage() {
  const recordings = await getRecordings();

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
      <h2 className="text-xl font-semibold tracking-tight mb-4">Recordings</h2>
      <RecordingsList initial={recordings} showRecordButton />

      {/* Sessions (plan U8/R18): the Listen page's surviving surfaces — the
          open-session recorder, the process-a-file escape hatch (inside the
          recorder), and session browsing — relocated here. */}
      <section className="mx-auto mt-12 w-full max-w-2xl">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Sessions</h2>
          <Link
            href="/practice/session"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            All sessions
          </Link>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Open practice sessions — recorded without a task, kept with audio and
          MIDI, linkable to pieces on demand.
        </p>
        <SessionRecorder />
        <div className="mt-4">
          <SessionList limit={6} />
        </div>
      </section>
    </div>
  );
}
