import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MemoryItem, MemoryVersion } from "@/lib/tuttles/memory";
import { MemoryHistory, ParentNotes, RewriteNowButton } from "@/components/tuttles/memory-controls";

export const dynamic = "force-dynamic";
// "Rewrite now" runs the nightly rewrite before the action returns.
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What Tuttles knows about a kid: the profile the tutor works from (rewritten
 * each night they chat, src/lib/tuttles/memory.ts), the parents' own notes,
 * and every past version with what changed, restorable. Parents only (the
 * middleware gates /tuttles).
 */
export default async function MemoryPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  if (!UUID.test(studentId)) notFound();
  const db = createAdminClient();
  const [{ data: kid }, { data: versions }, { data: notes }] = await Promise.all([
    db.from("family_members").select("name, role").eq("user_id", studentId).maybeSingle(),
    db
      .from("tutor_memories")
      .select("id, version, profile, changes, source, created_at")
      .eq("student_id", studentId)
      .order("version", { ascending: false })
      .limit(60),
    db.from("tutor_parent_notes").select("id, body, created_at").eq("student_id", studentId).order("created_at"),
  ]);
  if (!kid || kid.role !== "kid") notFound();
  const all = (versions ?? []) as MemoryVersion[];
  const current = all[0];
  const name = kid.name ?? "Kid";

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 pb-24 pt-10">
      <Link href="/tuttles" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Tuttles
      </Link>
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl tracking-tight text-foreground">What Tuttles knows about {name}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Patterns from {name}’s chats and grades, rewritten each night {name} chats. An item needs at least two
            signs to get in, and drops out once it’s fixed or hasn’t come up for three weeks. {name} can read this
            (not your notes) in the app.
          </p>
        </div>
        <RewriteNowButton studentId={studentId} />
      </header>

      <section className="mb-10">
        {!current || (current.profile.learning.length === 0 && current.profile.classes.length === 0) ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing yet. Patterns appear once they’ve shown up at least twice.
          </p>
        ) : (
          <div className="space-y-6">
            {current.profile.learning.length > 0 && (
              <Group title="How they learn best" items={current.profile.learning} />
            )}
            {current.profile.classes.map((c) => (
              <div key={c.name} className="rounded-xl border border-foreground/10 bg-card px-4 py-3">
                <h3 className="mb-2 font-serif text-base text-foreground">{c.name}</h3>
                {c.strengths.length > 0 && <Group title="Strong" items={c.strengths} compact />}
                {c.shaky.length > 0 && <Group title="Still working on" items={c.shaky} compact />}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-1 px-1 font-serif text-lg text-foreground">Your notes</h2>
        <p className="mb-3 px-1 text-xs text-muted-foreground">
          The tutor always sees these, and the nightly rewrite never changes them. {name} doesn’t see them.
        </p>
        <ParentNotes studentId={studentId} notes={notes ?? []} />
      </section>

      <section>
        <h2 className="mb-3 px-1 font-serif text-lg text-foreground">History</h2>
        <MemoryHistory studentId={studentId} versions={all.map(({ version, changes, source, created_at }) => ({ version, changes, source, created_at }))} />
      </section>
    </div>
  );
}

function Group({ title, items, compact }: { title: string; items: MemoryItem[]; compact?: boolean }) {
  return (
    <div className={compact ? "mb-2 last:mb-0" : "rounded-xl border border-foreground/10 bg-card px-4 py-3"}>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.text}>
            <p className="text-[0.95rem] text-foreground">{item.text}</p>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                {item.evidence.length} {item.evidence.length === 1 ? "sign" : "signs"}, last seen {item.lastSeen}
              </summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {item.evidence.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
