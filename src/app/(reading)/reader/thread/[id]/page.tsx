import { redirect } from "next/navigation";
import { readerLibraryHref, bookMarkHref } from "@/lib/reading/links";
import { resolveSharedMark } from "../../thread-actions";

export const dynamic = "force-dynamic";

/**
 * Where a mention's link lands.
 *
 * Nothing renders here. The link names a CONVERSATION, because that is the only
 * thing both people have in common — the mark is per copy, and the recipient's
 * copy may not have existed when the link was written. So this resolves the
 * conversation into whichever mark belongs to whoever just clicked, and sends
 * them there.
 *
 * It is also the last chance to finish a share that didn't. Placing a mark in
 * somebody's book happens after the response that created the share, so it can
 * fail quietly; resolving heals it, which means a link always works even when
 * the work behind it didn't.
 */
export default async function SharedMarkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const placed = await resolveSharedMark(id);
  if (!placed) redirect(readerLibraryHref());
  redirect(bookMarkHref(placed.bookId, placed.annotationId));
}
