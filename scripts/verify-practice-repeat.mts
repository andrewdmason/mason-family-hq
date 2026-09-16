// Checks repeating practice items against LOCAL Supabase: the scheduling math,
// the rule for which scheduled occurrences can be withdrawn, and the schema
// that backs them. Seeds throwaway rows and deletes them at the end.
// Run: npx tsx scripts/verify-practice-repeat.mts

import { config } from "dotenv";
config({ path: ".env.local" });

const { createAdminClient } = await import("../src/lib/supabase/admin");
const {
  REPEAT_INTERVAL_OPTIONS,
  isUntouchedOccurrence,
  nextOccurrenceDate,
  relativeDayLabel,
  relativeDayPhrase,
  repeatIntervalLabel,
} = await import("../src/lib/practice/repeat");

const admin = createAdminClient();

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const base = {
  completed: false,
  started_at: null as string | null,
  timer_seconds: 900,
  timer_remaining_seconds: 900,
};

console.log("\nCadence labels");
check("every day reads as 'Every day'", repeatIntervalLabel(1) === "Every day");
check("three days reads as 'Every 3 days'", repeatIntervalLabel(3) === "Every 3 days");
check("seven days reads as 'Every week'", repeatIntervalLabel(7) === "Every week");
check(
  "every offered interval has a label",
  REPEAT_INTERVAL_OPTIONS.every((d) => repeatIntervalLabel(d).length > 0)
);

console.log("\nScheduling is rolling, never into the past");
check(
  "today + 3 lands three days out",
  nextOccurrenceDate("2026-09-16", 3, "2026-09-16") === "2026-09-19"
);
check(
  "a stale item archived late schedules from today, not its own day",
  nextOccurrenceDate("2026-09-10", 3, "2026-09-16") === "2026-09-19"
);
check(
  "an item already sitting on a future day schedules from that day",
  nextOccurrenceDate("2026-09-20", 2, "2026-09-16") === "2026-09-22"
);
check(
  "a daily item comes back tomorrow",
  nextOccurrenceDate("2026-09-16", 1, "2026-09-16") === "2026-09-17"
);

console.log("\nHow a scheduled day reads");
check(
  "one day out is 'tomorrow'",
  relativeDayPhrase("2026-09-17", "2026-09-16") === "tomorrow"
);
check(
  "two days out is 'the day after'",
  relativeDayPhrase("2026-09-18", "2026-09-16") === "the day after"
);
check(
  "inside the week is a weekday name",
  relativeDayPhrase("2026-09-19", "2026-09-16") === "Saturday",
  relativeDayPhrase("2026-09-19", "2026-09-16")
);
check(
  "beyond the week is a plain date",
  relativeDayPhrase("2026-10-02", "2026-09-16") === "Oct 2",
  relativeDayPhrase("2026-10-02", "2026-09-16")
);
check(
  "chips capitalise the same phrase",
  relativeDayLabel("2026-09-17", "2026-09-16") === "Tomorrow"
);

console.log("\nWhich occurrences can be withdrawn");
check("an untouched copy can be withdrawn", isUntouchedOccurrence(base));
check(
  "one that's been timed stays put",
  !isUntouchedOccurrence({ ...base, timer_remaining_seconds: 500 })
);
check(
  "one that's been started stays put",
  !isUntouchedOccurrence({ ...base, started_at: new Date().toISOString() })
);
check(
  "one already archived stays put",
  !isUntouchedOccurrence({ ...base, completed: true })
);
check(
  "a copy with no time goal still counts as untouched",
  isUntouchedOccurrence({ ...base, timer_seconds: 0, timer_remaining_seconds: 0 })
);

console.log("\nSchema");
const created: string[] = [];
const cleanup = async () => {
  if (created.length > 0) {
    await admin.from("practice_tasks").delete().in("id", created);
  }
};

try {
  const { data: source, error: sourceErr } = await admin
    .from("practice_tasks")
    .insert({
      date: "2026-09-16",
      text: "verify-practice-repeat source",
      repeat_interval_days: 3,
    })
    .select("id, repeat_interval_days")
    .single();
  check("a cadence can be stored on an item", !sourceErr && source?.repeat_interval_days === 3, sourceErr?.message);
  if (source) created.push(source.id);

  const { error: badErr } = await admin
    .from("practice_tasks")
    .insert({ date: "2026-09-16", text: "verify bad", repeat_interval_days: 0 });
  check("a zero-day cadence is rejected", !!badErr);

  if (source) {
    const { data: occurrence, error: occErr } = await admin
      .from("practice_tasks")
      .insert({
        date: "2026-09-19",
        text: "verify-practice-repeat occurrence",
        repeat_interval_days: 3,
        repeat_source_task_id: source.id,
      })
      .select("id, repeat_source_task_id")
      .single();
    check(
      "an occurrence points back at what spawned it",
      !occErr && occurrence?.repeat_source_task_id === source.id,
      occErr?.message
    );
    if (occurrence) created.push(occurrence.id);

    const { data: found } = await admin
      .from("practice_tasks")
      .select("id")
      .eq("repeat_source_task_id", source.id);
    check(
      "occurrences are findable from their source",
      (found ?? []).length === 1 && found![0].id === occurrence?.id
    );

    // Deleting the source must not take its scheduled copy with it — a day of
    // practice shouldn't lose rows because an old item was tidied away.
    await admin.from("practice_tasks").delete().eq("id", source.id);
    const { data: orphan } = await admin
      .from("practice_tasks")
      .select("id, repeat_source_task_id")
      .eq("id", occurrence!.id)
      .maybeSingle();
    check(
      "deleting the source leaves the occurrence standing",
      !!orphan && orphan.repeat_source_task_id === null
    );
  }
} finally {
  await cleanup();
}

console.log(
  failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
