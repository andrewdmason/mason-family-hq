import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { bookReaderHref, readerLibraryHref } from "@/lib/reading/links";
import { READER_PLACE_COOKIE, parseReaderPlace } from "@/lib/reading/last-place";
import { getResumeBookId } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Opening Reader returns you to wherever you left off — back in your book if
 * you were reading, on the shelf if that's where you stopped. A device that
 * hasn't been here before falls back to your most recently read book, and a
 * brand-new reader with nothing to resume lands on the shelf.
 *
 * A book that's since been deleted or archived just bounces to the shelf from
 * the read route, which re-records the place — so a stale cookie self-heals.
 */
export default async function ReaderPage() {
  const place = parseReaderPlace(
    (await cookies()).get(READER_PLACE_COOKIE)?.value
  );
  if (place?.kind === "library") redirect(readerLibraryHref());
  if (place?.kind === "book") redirect(bookReaderHref(place.bookId));

  const bookId = await getResumeBookId();
  redirect(bookId ? bookReaderHref(bookId) : readerLibraryHref());
}
