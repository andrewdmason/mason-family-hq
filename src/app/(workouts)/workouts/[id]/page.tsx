import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSessionDetail } from "@/lib/workouts/queries";
import { WorkoutSessionView } from "@/components/workouts/workout-session-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workout",
};

export default async function WorkoutDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const session = await getSessionDetail(supabase, id);
  if (!session) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <div className="mb-4">
        <Link
          href="/workouts"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Workouts
        </Link>
      </div>

      <WorkoutSessionView sessionId={id} />
    </main>
  );
}
