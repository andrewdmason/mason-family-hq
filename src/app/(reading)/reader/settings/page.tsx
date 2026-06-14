import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  ReadingApiTokens,
  type ReadingApiTokenRow,
} from "@/components/reading/api-tokens";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reader settings" };

/**
 * Reader settings: personal API tokens for the Chrome article-capture
 * extension. Always your own tokens — no view-as here.
 */
export default async function ReaderSettingsPage() {
  const supabase = await createClient();
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
    </main>
  );
}
