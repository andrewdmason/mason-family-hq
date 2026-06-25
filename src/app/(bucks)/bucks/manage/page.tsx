import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { BucksAdmin } from "@/components/bucks/bucks-admin";
import { getIsAdult } from "@/lib/members/auth";
import { loadManageData } from "./actions";

export const dynamic = "force-dynamic";

export default async function BucksManagePage() {
  if (!(await getIsAdult())) redirect("/bucks");
  const data = await loadManageData();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <Link
        href="/bucks"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Mason Bucks
      </Link>
      <h1 className="mt-2 font-serif text-2xl tracking-tight text-foreground">
        Manage Mason Bucks
      </h1>
      <BucksAdmin data={data} />
    </main>
  );
}
