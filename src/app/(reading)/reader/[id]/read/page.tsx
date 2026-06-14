import { redirect } from "next/navigation";
import { BookReader } from "@/components/reading/book-reader";
import { listFamilyMembers } from "@/app/(journal)/settings/family/actions";
import { getIsOwner } from "@/lib/members/auth";
import { readingHomeHref } from "@/lib/reading/links";
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
  searchParams: Promise<{ member?: string }>;
}) {
  const { id } = await params;
  const { member } = await searchParams;

  const isOwner = await getIsOwner();
  const members = isOwner ? await listFamilyMembers() : [];
  const ownerEmail = members.find((m) => m.role === "owner")?.email ?? "";
  const viewable = members.filter((m) => m.role === "owner" || m.user_id);
  const requested = isOwner ? member?.trim().toLowerCase() || null : null;
  const viewingEmail =
    requested && requested !== ownerEmail
      ? viewable.find((m) => m.email === requested && m.role !== "owner")?.email ?? null
      : null;

  const data = await getBookReaderData(id, viewingEmail);
  // Nothing readable yet — send them back to the list to upload/convert.
  if (!data) redirect(readingHomeHref(viewingEmail));

  return (
    <BookReader
      bookId={id}
      memberEmail={viewingEmail}
      title={data.title}
      author={data.author}
      isArticle={data.isArticle}
      contentUrl={data.contentUrl}
      hasRealPages={data.hasRealPages}
      pageCount={data.pageCount}
      toc={data.toc}
      resumeAnchorId={data.resume.anchorId}
      resumeScrollRatio={data.resume.scrollRatio}
      backHref={readingHomeHref(viewingEmail)}
    />
  );
}
