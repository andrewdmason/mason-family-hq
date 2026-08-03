import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { bookReaderHref, readerLibraryHref } from "@/lib/reading/links";
import {
  READER_PLACE_COOKIE,
  parseReaderPlace,
  resumeTarget,
} from "@/lib/reading/last-place";
import { getResumeCandidates } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Opening Reader returns you to wherever you left off — back in your book if
 * you were reading, on the shelf if that's where you stopped. A device that
 * hasn't been here before falls back to your most recently read book, and a
 * brand-new reader with nothing to resume lands on the shelf.
 *
 * Where this device was doesn't get the last word, though: a book you've read
 * more recently somewhere else wins, because otherwise a device that once landed
 * on a book opens there forever — see resumeTarget.
 *
 * A book that's since been deleted or archived just bounces to the shelf from
 * the read route, which re-records the place — so a stale cookie self-heals.
 */
export default async function ReaderPage() {
  const place = parseReaderPlace(
    (await cookies()).get(READER_PLACE_COOKIE)?.value
  );
  // Leaving off on the shelf is its own answer, and knowing it costs no query —
  // worth keeping, because this runs on every cold launch of the installed app.
  if (place?.kind === "library") redirect(readerLibraryHref());

  const target = resumeTarget(place, await getResumeCandidates());
  redirect(
    target.kind === "book"
      ? bookReaderHref(target.bookId)
      : readerLibraryHref()
  );
}
