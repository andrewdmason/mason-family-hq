import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { WordList } from "@/components/words/word-list";
import { getIsAdult, requireUserId } from "@/lib/members/auth";
import { getProfile, loadList, loadStudents } from "@/lib/words/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "All words" };

export default async function WordsListPage({ searchParams }: { searchParams: Promise<{ kid?: string }> }) {
  const userId = await requireUserId();
  const { kid } = await searchParams;

  // A parent looking at one of the kids; anyone else sees their own.
  let who = userId;
  let name: string | null = null;
  if (kid && kid !== userId && (await getIsAdult())) {
    const student = (await loadStudents()).find((s) => s.userId === kid);
    if (student) {
      who = student.userId;
      name = student.name;
    }
  }
  const profile = await getProfile(who);
  if (!profile) redirect("/words");
  const [words, parts] = await Promise.all([loadList(profile, "words"), loadList(profile, "parts")]);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-5 py-6">
      <Link href="/words" className="flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Back
      </Link>
      <h1 className="mt-2 font-serif text-2xl tracking-tight text-foreground">{name ? `${name}’s words` : "All words"}</h1>
      <WordList words={words} parts={parts} />
    </main>
  );
}
