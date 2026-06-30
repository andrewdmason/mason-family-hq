import Link from "next/link";
import { Settings } from "lucide-react";
import { BucksMemberSwitcher } from "@/components/bucks/member-switcher";
import { WalletView } from "@/components/bucks/wallet-view";
import { listFamilyMembers } from "@/app/(journal)/settings/family/actions";
import { getIsAdult, getIsOwner } from "@/lib/members/auth";
import { loadWallet } from "./actions";

export const dynamic = "force-dynamic";

function firstName(name: string | null, fallback: string): string {
  return name?.trim().split(/\s+/)[0] || fallback;
}

export default async function BucksPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  const { member } = await searchParams;

  // Adults (owner + parents) get the Manage link. But viewing *another* member's
  // wallet is owner-only — both listFamilyMembers() and resolveMoneyScope()'s
  // member mode require the owner — so the member switcher is gated on isOwner.
  const [isAdult, isOwner] = await Promise.all([getIsAdult(), getIsOwner()]);
  const members = isOwner ? await listFamilyMembers() : [];
  const ownerEmail = members.find((m) => m.role === "owner")?.email ?? "";
  const viewable = members.filter((m) => m.role === "owner" || m.user_id);

  const requested = isOwner ? member?.trim().toLowerCase() || null : null;
  const viewedMember =
    requested && requested !== ownerEmail
      ? viewable.find((m) => m.email === requested && m.role !== "owner") ?? null
      : null;
  const viewingEmail = viewedMember?.email ?? null;

  const wallet = await loadWallet(viewingEmail);

  const heading = viewedMember
    ? `${firstName(viewedMember.name, "Their")}'s Mason Bucks`
    : "Mason Bucks";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">
          {heading}
        </h1>
        <div className="flex items-center gap-2">
          {isAdult && (
            <Link
              href="/bucks/manage"
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
              Manage
            </Link>
          )}
          {isOwner && viewable.length > 1 && (
            <BucksMemberSwitcher
              members={viewable}
              ownerEmail={ownerEmail}
              currentEmail={viewingEmail ?? ownerEmail}
            />
          )}
        </div>
      </div>

      {viewedMember && (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-2 text-xs text-muted-foreground">
          You&apos;re viewing{" "}
          <span className="font-medium text-foreground">
            {viewedMember.name ?? viewedMember.email}
          </span>
          &apos;s wallet. Anything you redeem is spent from their balance.
        </p>
      )}

      <WalletView wallet={wallet} memberEmail={viewingEmail} />
    </main>
  );
}
