// End-to-end check for Mason Bucks earning hooks against LOCAL Supabase.
// Exercises the journal quality gate (words + wall-clock), grant idempotency,
// and reading-bonus crediting. Seeds throwaway rows and deletes them at the end.
// Run: npx tsx scripts/verify-bucks-e2e.mts

import { config } from "dotenv";
config({ path: ".env.local" });

const { createAdminClient } = await import("../src/lib/supabase/admin");
const { creditReadingBonus, awardJournalEntryBucks } = await import(
  "../src/lib/bucks/earn"
);

const admin = createAdminClient();

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

function uuid(): string {
  return crypto.randomUUID();
}

const words = (n: number) => Array(n).fill("word").join(" ");

// A kid to attribute everything to.
const { data: kid } = await admin
  .from("family_members")
  .select("user_id")
  .eq("role", "kid")
  .not("user_id", "is", null)
  .limit(1)
  .maybeSingle();
if (!kid?.user_id) {
  console.error("No kid with a user_id in local DB; cannot run.");
  process.exit(1);
}
const userId = kid.user_id as string;

const createdEntries: string[] = [];
const createdRefs: string[] = [];

async function ledgerFor(referenceId: string, source: string): Promise<number> {
  const { data } = await admin
    .from("bucks_ledger")
    .select("amount")
    .eq("reference_id", referenceId)
    .eq("source", source);
  return (data ?? []).reduce((s, r) => s + (r.amount as number), 0);
}

async function seedEntry(opts: {
  entryDate: string;
  startedMinutesAgo: number;
  closedMinutesAgo: number;
  userWords: number;
}): Promise<string> {
  const now = Date.now();
  const started = new Date(now - opts.startedMinutesAgo * 60_000).toISOString();
  const closed = new Date(now - opts.closedMinutesAgo * 60_000).toISOString();
  const { data: entry, error } = await admin
    .from("journal_entries")
    .insert({
      user_id: userId,
      entry_date: opts.entryDate,
      status: "closed",
      freeform_started_at: started,
      closed_at: closed,
    })
    .select("id")
    .single();
  if (error || !entry) throw new Error(error?.message ?? "seed entry failed");
  const id = entry.id as string;
  createdEntries.push(id);
  createdRefs.push(id);
  const { error: msgErr } = await admin.from("journal_messages").insert([
    { entry_id: id, user_id: userId, role: "user", content: words(opts.userWords) },
    { entry_id: id, user_id: userId, role: "assistant", content: words(500) }, // must NOT count
  ]);
  if (msgErr) throw new Error(msgErr.message);
  return id;
}

try {
  // 1. Qualifying entry: 160 words, ~7 min -> +5, once (idempotent on re-run).
  const good = await seedEntry({
    entryDate: "2000-01-01",
    startedMinutesAgo: 7,
    closedMinutesAgo: 0,
    userWords: 160,
  });
  await awardJournalEntryBucks(good);
  check("qualifying entry grants 5", (await ledgerFor(good, "journal")) === 5);
  await awardJournalEntryBucks(good);
  check(
    "re-running the grant is idempotent (still 5)",
    (await ledgerFor(good, "journal")) === 5
  );

  // 2. Too few words: 90 words, 7 min -> no grant.
  const short = await seedEntry({
    entryDate: "2000-01-02",
    startedMinutesAgo: 7,
    closedMinutesAgo: 0,
    userWords: 90,
  });
  await awardJournalEntryBucks(short);
  check("under 150 words → no grant", (await ledgerFor(short, "journal")) === 0);

  // 3. Enough words but too fast: 200 words, 3 min -> no grant.
  const fast = await seedEntry({
    entryDate: "2000-01-03",
    startedMinutesAgo: 3,
    closedMinutesAgo: 0,
    userWords: 200,
  });
  await awardJournalEntryBucks(fast);
  check("under 5 minutes → no grant", (await ledgerFor(fast, "journal")) === 0);

  // 4. Reading bonus credit is 1:1 and idempotent per advance id.
  const advanceId = uuid();
  createdRefs.push(advanceId);
  await creditReadingBonus(userId, advanceId, 12);
  await creditReadingBonus(userId, advanceId, 12);
  check(
    "reading bonus credits 12 once (idempotent)",
    (await ledgerFor(advanceId, "reading")) === 12
  );

  // 5. Zero bonus pages → no row.
  const zeroAdvance = uuid();
  createdRefs.push(zeroAdvance);
  await creditReadingBonus(userId, zeroAdvance, 0);
  check("zero bonus pages → no row", (await ledgerFor(zeroAdvance, "reading")) === 0);
} finally {
  // Clean up everything this script created.
  for (const ref of createdRefs) {
    await admin.from("bucks_ledger").delete().eq("reference_id", ref);
  }
  for (const id of createdEntries) {
    await admin.from("journal_messages").delete().eq("entry_id", id);
    await admin.from("journal_entries").delete().eq("id", id);
  }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
