import { WalletView } from "@/components/bucks/wallet-view";
import { BucksParentView } from "@/components/bucks/bucks-parent-view";
import { getIsAdult } from "@/lib/members/auth";
import { loadAdminBucks } from "@/lib/bucks/admin-data";
import { loadWallet } from "./actions";

export const dynamic = "force-dynamic";

export default async function BucksPage() {
  // Adults manage the family's Bucks (both kids, tasks, prizes, awards). Kids see
  // their own wallet. There is no adult wallet — we don't run adult balances.
  if (await getIsAdult()) {
    const data = await loadAdminBucks();
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <BucksParentView data={data} />
      </main>
    );
  }

  const wallet = await loadWallet();
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <WalletView wallet={wallet} />
    </main>
  );
}
