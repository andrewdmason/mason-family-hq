import { redirect } from "next/navigation";
import { readingHomeHref } from "@/lib/reading/links";

export const dynamic = "force-dynamic";

/**
 * The Parent Admin console used to live here; it's now folded into the reading
 * home as per-kid tabs. Redirect any lingering links (?kid= scoped it) to the
 * matching tab there.
 */
export default async function ParentAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ kid?: string; member?: string }>;
}) {
  const { kid, member } = await searchParams;
  redirect(readingHomeHref(kid ?? member ?? null));
}
