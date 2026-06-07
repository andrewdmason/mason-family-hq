import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getIsOwner } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { getMovementLibrary } from "@/lib/workouts/library";
import { MovementLibrary } from "@/components/workouts/movement-library";
import { WorkoutsHeader } from "@/components/workouts/workouts-header";

export const dynamic = "force-dynamic";

export default async function MovementsPage() {
  const supabase = await createClient();
  // The library is shared vocabulary; curating it is owner-only.
  if (!(await getIsOwner(supabase))) notFound();

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);
  const families = await getMovementLibrary(supabase);
  const allMovements = families.flatMap((f) =>
    f.movements.map((m) => ({
      id: m.id,
      name: m.name,
      family: m.family,
      aliases: m.aliases,
    }))
  );
  const total = allMovements.length;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <WorkoutsHeader active="library" isOwner />
      <p className="mb-5 text-sm text-muted-foreground">
        {total} movements in the shared vocabulary. It grows automatically as
        workouts are imported — rename, re-file, toggle e1RM tracking, set
        substitutes, or merge duplicates here.
      </p>
      <MovementLibrary
        families={families}
        allMovements={allMovements}
        today={today}
      />
    </main>
  );
}
