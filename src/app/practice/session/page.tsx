import { notFound } from "next/navigation";
import { PRACTICE_AUTOLOG_ENABLED } from "@/lib/practice/flags";
import { SessionRecorder } from "@/components/practice/session-recorder";

export const metadata = {
  title: "Listen",
};

export default function SessionPage() {
  if (!PRACTICE_AUTOLOG_ENABLED) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Listen</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Record a practice session and have it logged automatically.
      </p>
      <SessionRecorder />
    </div>
  );
}
