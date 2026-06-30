import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getIsAdult } from "@/lib/members/auth";
import { loadAdminBucks } from "@/lib/bucks/admin-data";
import { BucksHistoryAdmin, KidHistoryList } from "@/components/bucks/bucks-history";
import { loadWallet } from "../actions";

export const dynamic = "force-dynamic";

export default async function BucksHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ kid?: string }>;
}) {
  const { kid } = await searchParams;

  let body: React.ReactNode;
  if (await getIsAdult()) {
    const data = await loadAdminBucks();
    body = (
      <BucksHistoryAdmin kids={data.kids} history={data.history} initialKid={kid ?? null} />
    );
  } else {
    const wallet = await loadWallet();
    body = <KidHistoryList entries={wallet.history} />;
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <Link
        href="/bucks"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Mason Bucks
      </Link>
      <h1 className="mt-2 font-serif text-2xl tracking-tight text-foreground">History</h1>
      <div className="mt-6">{body}</div>
    </main>
  );
}
