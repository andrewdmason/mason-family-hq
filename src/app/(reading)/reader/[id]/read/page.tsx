import { redirect } from "next/navigation";
import { BookReader } from "@/components/reading/book-reader";
import { getIsAdult } from "@/lib/members/auth";
import { readerLibraryHref } from "@/lib/reading/links";
import { getBookReaderData } from "../../actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Reading",
};

export default async function ReadBookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Always your own book: Reader is self-scoped, and the kids' books are
  // administered from Bookshelf rather than read here.
  const data = await getBookReaderData(id, null);
  // Nothing readable yet — send them back to the shelf to upload/convert.
  if (!data) redirect(readerLibraryHref());

  // Listening is adults-only for now, and deliberately so — see
  // lib/reading/audio/access.ts. The routes enforce it; this just keeps the
  // control from being offered to someone who can't use it.
  const canListen = await getIsAdult();

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
      backHref={readerLibraryHref()}
    />
  );
}
