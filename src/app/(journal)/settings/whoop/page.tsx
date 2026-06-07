import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { WhoopConnect } from "@/components/journal/whoop-connect";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "WHOOP Settings",
};

export default async function WhoopSettingsPage() {
  // Owner-only — the workouts logger is the owner's private app.
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const { data: me } = await supabase
    .from("family_members")
    .select("email, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (me?.role !== "owner") redirect("/settings/user");

  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("whoop_connections")
    .select("created_at")
    .eq("member_email", me.email as string)
    .maybeSingle();

  return (
    <div className="mt-6 max-w-xl">
      <h1 className="font-serif text-lg text-foreground">WHOOP</h1>
      <p className="mt-2 font-serif text-sm text-muted-foreground">
        Open a workout and press “Send to WHOOP” to push its resistance work (barbell
        and bodyweight strength, including the lifts inside a metcon) into WHOOP&apos;s
        Strength Trainer, so your muscular load and recovery account for it.
        Conditioning and mobility are left out. This is a one-way push — Family HQ
        stays the source of truth, and each send creates a new strength workout in
        WHOOP.
      </p>
      <p className="mt-2 font-serif text-xs italic text-muted-foreground">
        Heads up: this uses WHOOP&apos;s private app API, which is outside WHOOP&apos;s
        official terms. It runs only on your own account.
      </p>
      <div className="mt-5">
        <WhoopConnect connected={!!conn} connectedAt={(conn?.created_at as string) ?? null} />
      </div>
    </div>
  );
}
