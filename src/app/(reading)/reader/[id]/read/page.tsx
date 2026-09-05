import { redirect } from "next/navigation";
import { BookReader } from "@/components/reading/book-reader";
import { getIsAdult } from "@/lib/members/auth";
import { listRoster, mentionableMembers } from "@/lib/members/roster";
import { mentionTargets } from "@/lib/reading/mentions";
import { createClient } from "@/lib/supabase/server";
import { getSelfEmail } from "@/lib/todos/queries";
import { readerLibraryHref } from "@/lib/reading/links";
import { getBookReaderData } from "../../actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Reading",
};

export default async function ReadBookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /**
   * `notes=1` arrives from the shelf's annotation count — see bookNotesHref.
   * `mark=<id>` arrives from a mention's permalink, already resolved to this
   * reader's own copy by /reader/thread/[id].
   */
  searchParams: Promise<{ notes?: string; mark?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  // Always your own book: Reader is self-scoped, and the kids' books are
  // administered from Bookshelf rather than read here.
  const data = await getBookReaderData(id, null);
  // Nothing readable yet — send them back to the shelf to upload/convert.
  if (!data) redirect(readerLibraryHref());

  // Listening is adults-only for now, and deliberately so — see
  // lib/reading/audio/access.ts. The routes enforce it; this just keeps the
  // control from being offered to someone who can't use it.
  const canListen = await getIsAdult();

  // Who this reader can name in a mark. Resolved here, once, so the composer's
  // handles and the server's grants are the same list — and filtered to people
  // who can actually open the reader, because a mention that arrives as a link
  // its recipient gets redirected away from is worse than no mention at all.
  //
  // Both halves fall back to an empty picker rather than throwing. Naming
  // somebody is one thing you can do in a book; being unable to work out who
  // they are must not be a reason the book won't open. getSelfEmail in
  // particular throws when the signed-in session has no member row, which
  // happens locally whenever two Supabase projects share the localhost cookie
  // jar — and a reading app that 500s over an autocomplete list is a bad trade.
  const [roster, selfEmail] = await Promise.all([
    listRoster().catch(() => []),
    getSelfEmail(await createClient()).catch(() => null),
  ]);
  const targets = mentionTargets(mentionableMembers(roster, selfEmail));

  return (
    <BookReader
      canListen={canListen}
      bookId={id}
      memberEmail={null}
      title={data.title}
      author={data.author}
      isArticle={data.isArticle}
      dek={data.dek}
      heroImageUrl={data.heroImageUrl}
      contentUrl={data.contentUrl}
      wordCount={data.wordCount}
      toc={data.toc}
      resumeCharOffset={data.resume.charOffset}
      resumeSavedAt={data.resume.savedAt}
      readingFace={data.readingFace}
      fiction={data.fiction}
      charCount={data.charCount}
      hasRealPages={data.hasRealPages}
      openNotes={query.notes === "1"}
      openMarkId={query.mark ?? null}
      mentionTargets={targets}
      backHref={readerLibraryHref()}
    />
  );
}
