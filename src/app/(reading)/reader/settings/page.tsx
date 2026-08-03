import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  ReadingApiTokens,
  type ReadingApiTokenRow,
} from "@/components/reading/api-tokens";
import { formatCost } from "@/lib/reading/audio/constants";
import { getAudioSpend } from "@/lib/reading/audio/plan";
import { resolveReadingScope } from "@/lib/reading/scope";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reader settings" };

/**
 * Reader settings: personal API tokens for the Chrome article-capture
 * extension, and what listening has cost. Always your own — no view-as here.
 */
export default async function ReaderSettingsPage() {
  const supabase = await createClient();

  const scope = await resolveReadingScope(null);
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const spend = await getAudioSpend(scope.client, scope.userId, since);

  const { data: tokenRows } = await supabase
    .from("reading_api_tokens")
    .select("id, name, created_at, last_used_at")
    .order("created_at", { ascending: false });

  const tokens: ReadingApiTokenRow[] = (
    (tokenRows ?? []) as {
      id: string;
      name: string;
      created_at: string;
      last_used_at: string | null;
    }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <Link
        href="/reader"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to reading
      </Link>

      <h1 className="mb-1 font-serif text-2xl tracking-tight text-foreground">
        Reader settings
      </h1>
      <p className="mb-4 text-sm text-muted-foreground">
        API tokens authenticate the Chrome extension that saves web articles
        into your reader. Create one, paste it into the extension&apos;s options,
        and click the toolbar button on any article to save it.
      </p>

      <ReadingApiTokens tokens={tokens} />

      {/*
        Listening costs real money — a couple of dollars a chapter — and the
        design that keeps that safe is a number you can't avoid noticing rather
        than a cap. A cap would fail in the one place it must not: mid-chapter,
        with the voice stopping in the middle of a sentence. This is the whole
        safeguard, so it lives on the page rather than behind anything.
      */}
      <section className="mt-10">
        <h2 className="mb-1 font-serif text-lg tracking-tight text-foreground">
          Listening
        </h2>
        <p className="text-sm text-muted-foreground">
          {spend.chapters === 0 ? (
            <>Nothing has been narrated in the last 30 days.</>
          ) : (
            <>
              About{" "}
              <span className="font-medium text-foreground">
                {formatCost(spend.dollars)}
              </span>{" "}
              of narration in the last 30 days, across {spend.chapters}{" "}
              {spend.chapters === 1 ? "chapter" : "chapters"}.
            </>
          )}{" "}
          An estimate — the real figure depends on the plan&apos;s allowance and
          where in the month you are. Chapters are voiced once and kept, so
          re-listening is free.
        </p>
      </section>
    </main>
  );
}
