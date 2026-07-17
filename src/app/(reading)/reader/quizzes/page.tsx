import Link from "next/link";
import { redirect } from "next/navigation";
import { ReadingAdmin } from "@/components/reading/reading-admin";
import { getIsOwner } from "@/lib/members/auth";
import { readingHomeHref } from "@/lib/reading/links";
import { getReadingAdmin } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Parent Admin",
};

export default async function ParentAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ kid?: string }>;
}) {
  if (!(await getIsOwner())) redirect("/reader");

  const { kid } = await searchParams;
  const members = await getReadingAdmin();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">
          Parent Admin
        </h1>
        <Link
          href={readingHomeHref(null)}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Back to reading
        </Link>
      </div>

      {members.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          No reading to administer yet. Add a kid&apos;s book from the reading
          home to get started.
        </p>
      ) : (
        <ReadingAdmin members={members} initialEmail={kid ?? null} />
      )}
    </main>
  );
}
