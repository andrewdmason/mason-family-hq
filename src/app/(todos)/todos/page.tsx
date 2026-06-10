import { redirect } from "next/navigation";

// The app opens on Today — the lean "what can I act on right now" view.
// Preserve ?as= so a person-switched link to /todos stays switched.
export default async function TodosIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const { as } = await searchParams;
  redirect(as ? `/todos/today?as=${encodeURIComponent(as)}` : "/todos/today");
}
