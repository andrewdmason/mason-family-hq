import { createClient } from "@/lib/supabase/server";
import { KeepOffline, type KeepOfflineBook } from "./keep-offline";

export const dynamic = "force-dynamic";

export const metadata = { title: "Keeping books offline" };

/**
 * The Reader iOS app keeps your current and recent books on the device by
 * loading this page in a hidden web view with their ids (`?ids=a,b,c`). It
 * downloads each one the way opening it would (the book's text into the
 * reader's offline store, its reading page into the service worker's cache)
 * without opening it, so your place and reading history don't move. Not a
 * shelf place (src/lib/reading/last-place.ts), so visiting it doesn't either.
 */
export default async function KeepOfflinePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  const wanted = (ids ?? "")
    .split(",")
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, 20);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let books: KeepOfflineBook[] = [];
  if (user && wanted.length > 0) {
    const [{ data: rows }, { data: contents }] = await Promise.all([
      supabase
        .from("reading_books")
        .select("id, title, author, type")
        .eq("user_id", user.id)
        .in("id", wanted),
      supabase
        .from("reading_book_content")
        .select("book_id, status, updated_at")
        .eq("user_id", user.id)
        .in("book_id", wanted),
    ]);
    const ready = new Map(
      (contents ?? [])
        .filter((c) => c.status === "ready")
        .map((c) => [c.book_id as string, c.updated_at as string])
    );
    books = (rows ?? []).flatMap((row) => {
      const updatedAt = ready.get(row.id);
      if (!updatedAt) return [];
      return [
        {
          bookId: row.id,
          title: row.title,
          author: row.author,
          isArticle: row.type === "article",
          // The same URL the reading page asks for (getBookReaderData), so
          // the copy here is the one it finds.
          contentUrl: `/reader/api/content/${row.id}?v=${Date.parse(updatedAt)}`,
        },
      ];
    });
  }

  return <KeepOffline books={books} />;
}
