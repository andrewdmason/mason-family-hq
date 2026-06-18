import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PRACTICE_AUTOLOG_ENABLED } from "@/lib/practice/flags";
import { SessionRecorder } from "@/components/practice/session-recorder";

export const metadata = {
  title: "Listen",
};

export default async function SessionPage() {
  if (!PRACTICE_AUTOLOG_ENABLED) notFound();

  const supabase = await createClient();
  const { data: recent } = await supabase
    .from("practice_sessions")
    .select("id, date, status, confidence, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Listen</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Record a practice session and have it logged automatically.
      </p>
      <SessionRecorder />

      {recent && recent.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Recent sessions</h2>
          <div className="divide-y rounded-lg border">
            {recent.map((s) => (
              <Link
                key={s.id}
                href={`/practice/session/${s.id}`}
                className="flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/50"
              >
                <span>{s.date}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {s.status}
                  {s.confidence != null ? ` · ${Math.round(s.confidence * 100)}%` : ""}
                  <ChevronRightIcon className="size-3.5" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
