// End-to-end check of Words played with no connection: what the Tuttles app
// sends up afterwards (src/lib/words/offline.ts) lands in the tables exactly
// as if it had been answered on the website, and sending it twice changes
// nothing. Talks to LOCAL Supabase only, as a throwaway user it deletes after.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-words-offline-e2e.mts

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
config({ path: process.env.ENV_FILE ?? ".env.local" });
process.env.NEXT_PUBLIC_SUPABASE_ENV = "local";

const { supabaseUrl } = await import("../src/lib/supabase/config");
if (!/127\.0\.0\.1|localhost/.test(supabaseUrl ?? "")) throw new Error("This only runs against a local Supabase.");
const { createAdminClient } = await import("../src/lib/supabase/admin");
const { applyOffline, loadPack } = await import("../src/lib/words/offline");
const { answerQuestion, setProfile, startOrResume } = await import("../src/lib/words/session");
const { wordsFor } = await import("../src/lib/words/content");
const { wordsToday } = await import("../src/lib/words/day");
const { addDays } = await import("../src/lib/words/schedule");

const waiting = (requeue: unknown) => ((requeue ?? []) as { item: string; at: number }[]).map((r) => `${r.item}@${r.at}`).join(" ");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
};

const admin = createAdminClient();
const made = await admin.auth.admin.createUser({ email: `words-offline-${Date.now()}@example.test`, email_confirm: true });
if (made.error || !made.data.user) throw new Error(`make user: ${made.error?.message}`);
const userId = made.data.user.id;

try {
  const profile = await setProfile(userId, "lower");
  const today = wordsToday();
  const words = wordsFor("lower");
  const [a, b, c, d, e] = words;
  const form = (w: (typeof words)[number]) => Object.entries(w.forms)[0];
  const at = (n: number) => new Date(Date.now() - 60_000 + n * 1000).toISOString();

  console.log("The words come down once");
  const first = await loadPack(profile, "Test", null);
  check("a phone with nothing gets the words", !!first.content && first.content.words.length === words.length);
  check("the ways of asking keep their order", first.content!.words[0].forms.map((f) => f.key).join() === Object.keys(words[0].forms).join());
  const second = await loadPack(profile, "Test", first.contentVersion);
  check("a phone that has them doesn't get them again", !second.content && second.contentVersion === first.contentVersion);
  check("nothing done yet", second.progress.length === 0 && second.sessions.length === 0);

  console.log("\nA session played on the phone");
  const id = randomUUID();
  const session = { id, day: today, total: 5, limitMs: 600_000, noDontKnow: false, startedAt: at(0), finishedAt: null };
  const answer = (position: number, w: (typeof words)[number], chosen: string | null, result: "correct" | "wrong" | "dontknow", ms = 5000) => ({
    session: id,
    position,
    item: w.id,
    form: form(w)[0],
    chosen,
    result,
    ms,
    at: at(position),
  });
  const three = [
    answer(1, a, form(a)[1].answer, "correct"),
    answer(2, b, null, "dontknow"),
    // Sent as right by a phone that's wrong about it: the words here decide.
    answer(3, c, form(c)[1].traps[0].text, "correct", 999_999),
  ];
  await applyOffline(profile, [session], three);

  const read = async () => {
    const [{ data: s }, { data: answers }, { data: progress }] = await Promise.all([
      admin.from("words_sessions").select("*").eq("id", id).maybeSingle(),
      admin.from("words_answers").select("*").eq("session_id", id).order("position"),
      admin.from("words_progress").select("*").eq("user_id", userId),
    ]);
    return { s, answers: answers ?? [], progress: new Map((progress ?? []).map((p) => [p.item as string, p])) };
  };
  let now = await read();
  check("the session is there under the phone's id", now.s?.user_id === userId && now.s?.day === today);
  check("its score is counted from the answers", now.s?.answered === 3 && now.s?.correct === 1 && now.s?.wrong === 1 && now.s?.dontknow === 1);
  check("a question counts for a minute at most", now.s?.elapsed_ms === 5000 + 5000 + 60_000, String(now.s?.elapsed_ms));
  check("still open, with the two misses waiting to come round", !now.s?.finished_at && waiting(now.s?.requeue) === `${b.id}@2 ${c.id}@3`, waiting(now.s?.requeue));
  check("three new words", now.s?.new_items === 3);
  check("the answers are kept, with the trap fallen for", now.answers.length === 3 && now.answers[2].result === "wrong" && now.answers[2].trap === (form(c)[1].traps[0].trap ?? null));
  check("known at first sight is done with", now.progress.get(a.id)?.fast === true && now.progress.get(a.id)?.stage === 3);
  check("a miss is due tomorrow", now.progress.get(b.id)?.stage === 0 && now.progress.get(b.id)?.due_on === addDays(today, 1));

  const pack = await loadPack(profile, "Test", first.contentVersion);
  const mine = pack.sessions.find((s) => s.id === id);
  // For checking that the app reads what's really sent: DUMP_PACK=<file>.
  if (process.env.DUMP_PACK) writeFileSync(process.env.DUMP_PACK, JSON.stringify(await loadPack(profile, "Test", null)));
  check("the phone is told where the session stands", mine?.answered === 3 && mine.asked.join() === [a.id, b.id, c.id].join() && mine.missed.join() === [b.id, c.id].join());

  console.log("\nSent again (the reply never arrived)");
  await applyOffline(profile, [session], three);
  now = await read();
  check("nothing is counted twice", now.answers.length === 3 && now.s?.answered === 3 && now.s?.new_items === 3 && now.progress.get(a.id)?.seen === 1 && now.progress.get(b.id)?.dontknow_count === 1);

  console.log("\nPicked up on the website");
  const resumed = await startOrResume(profile, { key: true });
  check("the website carries on the same session", resumed.sessionId === id && resumed.question?.position === 4);
  const web = await answerQuestion(userId, id, 4, null, 3000, { key: true });
  check("and takes an answer", !!web && web.state.question?.position === 5);
  // The phone, not knowing, answers the same question, and then the last.
  await applyOffline(profile, [{ ...session, finishedAt: at(9) }], [...three, answer(4, d, form(d)[1].answer, "correct"), answer(5, e, form(e)[1].answer, "correct")]);
  now = await read();
  check("the question the website answered first stays the website's", now.answers.length === 5 && now.answers[3].result === "dontknow" && !now.progress.has(d.id));
  check("the phone's last answer finishes it", now.s?.answered === 5 && !!now.s?.finished_at && now.s?.current === null && JSON.stringify(now.s?.requeue) === "[]");
  check("the time is the website's and the phone's together", now.s?.elapsed_ms === 70_000 + 3000 + 5000, String(now.s?.elapsed_ms));

  console.log("\nSomeone else's session");
  const other = await admin.auth.admin.createUser({ email: `words-offline-other-${Date.now()}@example.test`, email_confirm: true });
  const otherId = other.data.user!.id;
  try {
    const theirs = await setProfile(otherId, "lower");
    await applyOffline(theirs, [{ ...session, finishedAt: null }], [{ ...answer(1, a, null, "dontknow"), position: 6 }]);
    now = await read();
    const { count } = await admin.from("words_progress").select("*", { count: "exact", head: true }).eq("user_id", otherId);
    check("can't be added to", now.answers.length === 5 && count === 0);
  } finally {
    await admin.auth.admin.deleteUser(otherId);
  }

  console.log("\nYesterday's session, sent today");
  const late = randomUUID();
  const yesterday = addDays(today, -1);
  await applyOffline(profile, [{ id: late, day: yesterday, total: 5, limitMs: 600_000, noDontKnow: false, startedAt: at(20), finishedAt: null }], [
    { session: late, position: 1, item: words[10].id, form: form(words[10])[0], chosen: null, result: "dontknow", ms: 4000, at: at(21) },
  ]);
  const { data: lateRow } = await admin.from("words_sessions").select("day").eq("id", late).maybeSingle();
  const { data: lateProgress } = await admin.from("words_progress").select("due_on, first_seen_on").eq("user_id", userId).eq("item", words[10].id).maybeSingle();
  check("counts on the day it was played", lateRow?.day === yesterday && lateProgress?.first_seen_on === yesterday && lateProgress?.due_on === today);
} finally {
  await admin.auth.admin.deleteUser(userId);
}

console.log(failures > 0 ? `\n${failures} checks failed` : "\nwords offline: all checks passed");
process.exit(failures > 0 ? 1 : 0);
