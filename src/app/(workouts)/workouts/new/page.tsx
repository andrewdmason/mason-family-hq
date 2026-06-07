import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { NewSessionForm } from "@/components/workouts/new-session-form";

export const dynamic = "force-dynamic";

export default async function NewWorkoutPage() {
  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <Link
        href="/workouts"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Workouts
      </Link>
      <h1 className="mb-1 font-serif text-2xl tracking-tight text-foreground">
        Log a workout
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Paste the workout and we&apos;ll structure it — then log what you actually did.
      </p>
      <NewSessionForm today={today} />
    </main>
  );
}
