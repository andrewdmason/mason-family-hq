import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import {
  getAssignmentsForViewer,
  getMyBentleyConnection,
} from "@/lib/assignments/queries";
import { hasAnyConnection } from "@/lib/assignments/sync";
import { AssignmentsClient } from "@/components/assignments/assignments-client";
import { ConnectBentley } from "@/components/assignments/connect-bentley";
import { SyncTrigger } from "@/components/assignments/sync-trigger";

export default async function AssignmentsPage() {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data: me } = await supabase
    .from("family_members")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  const role = me?.role ?? null;
  const isParent = role === "owner" || role === "parent";

  const [kids, connected, myConnection] = await Promise.all([
    getAssignmentsForViewer(),
    hasAnyConnection(),
    isParent ? getMyBentleyConnection() : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 pb-24 pt-10">
      <SyncTrigger />
      <header className="mb-8">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">
          School Assignments
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isParent
            ? "Homework and due dates from Bentley, for both kids."
            : "Your homework and due dates from Bentley."}
        </p>
      </header>

      {isParent && <ConnectBentley connection={myConnection} />}

      <AssignmentsClient
        kids={kids}
        isParent={isParent}
        connected={connected}
      />
    </div>
  );
}
