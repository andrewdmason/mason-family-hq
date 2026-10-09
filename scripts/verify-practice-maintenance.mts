// Checks the maintenance rotation against LOCAL Supabase: which piece it picks
// and why, and — the part that is easy to get wrong — what counts as having
// practiced something. Seeds throwaway rows and deletes them at the end.
// Run: npx tsx --tsconfig scripts/tsconfig.json scripts/verify-practice-maintenance.mts

import { config } from "dotenv";
config({ path: ".env.local" });

const { createAdminClient } = await import("../src/lib/supabase/admin");
const {
  MAINTENANCE_GOAL_SECONDS,
  daysSinceLabel,
  maintenanceLabel,
  pickMaintenancePiece,
} = await import("../src/lib/practice/maintenance");
const { daysBetween } = await import("../src/lib/date-utils");
type Piece = import("../src/lib/types").Piece;

const admin = createAdminClient();

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const piece = (id: string, name: string, maintenance = true): Piece => ({
  id,
  work_id: null,
  name,
  composer: null,
  status: "active",
  kind: "piece",
  maintenance,
  notes: null,
  target_tempo: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

const ASOF = "2026-09-20";
const nocturne = piece("p-nocturne", "Nocturne");
const ballade = piece("p-ballade", "Ballade");
const etude = piece("p-etude", "Etude");
const daily = piece("p-daily", "Daily piece", false);

console.log("\nWho the rotation picks");
check(
  "the piece untouched longest wins",
  pickMaintenancePiece({
    pieces: [nocturne, ballade],
    lastPracticedByPiece: { "p-nocturne": "2026-09-18", "p-ballade": "2026-09-01" },
    excluded: new Set(),
    asOf: ASOF,
  })?.piece.id === "p-ballade"
);
check(
  "never practiced beats a 90-day-old piece",
  pickMaintenancePiece({
    pieces: [nocturne, ballade],
    lastPracticedByPiece: { "p-ballade": "2026-06-22" },
    excluded: new Set(),
    asOf: ASOF,
  })?.piece.id === "p-nocturne"
);
check(
  "equal ages break on name, the same way every time",
  [0, 1].every(
    () =>
      pickMaintenancePiece({
        pieces: [nocturne, ballade],
        lastPracticedByPiece: {
          "p-nocturne": "2026-09-10",
          "p-ballade": "2026-09-10",
        },
        excluded: new Set(),
        asOf: ASOF,
      })?.piece.id === "p-ballade"
  )
);
check(
  "a piece not in the rotation is never offered",
  pickMaintenancePiece({
    pieces: [daily],
    lastPracticedByPiece: {},
    excluded: new Set(),
    asOf: ASOF,
  }) === null
);

console.log("\nSkipping what is already asking for attention");
const threeWay = {
  pieces: [nocturne, ballade, etude],
  lastPracticedByPiece: {
    "p-nocturne": "2026-09-19",
    "p-ballade": "2026-09-01",
    "p-etude": "2026-09-10",
  },
  asOf: ASOF,
};
check(
  "an excluded piece is passed over for the next stalest",
  pickMaintenancePiece({ ...threeWay, excluded: new Set(["p-ballade"]) })?.piece
    .id === "p-etude"
);
check(
  "two taps in a row name two different pieces",
  pickMaintenancePiece({ ...threeWay, excluded: new Set(["p-ballade", "p-etude"]) })
    ?.piece.id === "p-nocturne"
);
check(
  "clearing an exclusion brings the piece straight back",
  pickMaintenancePiece({ ...threeWay, excluded: new Set() })?.piece.id ===
    "p-ballade"
);
check(
  "an exhausted pool offers nothing",
  pickMaintenancePiece({
    ...threeWay,
    excluded: new Set(["p-nocturne", "p-ballade", "p-etude"]),
  }) === null
);

console.log("\nHow it reads");
check(
  "the button names its piece and its age",
  maintenanceLabel({ piece: ballade, daysSince: 19 }) ===
    "Maintenance — Ballade · 19d"
);
check("a never-practiced piece reads 'new'", daysSinceLabel(null) === "new");
check("the goal is twenty minutes", MAINTENANCE_GOAL_SECONDS === 1200);

console.log("\nDay arithmetic");
check("nineteen days apart counts as nineteen", daysBetween("2026-09-01", "2026-09-20") === 19);
check("the same day is zero", daysBetween("2026-09-20", "2026-09-20") === 0);
check(
  "a spring DST boundary is still whole days",
  daysBetween("2026-03-07", "2026-03-09") === 2
);
check(
  "an autumn DST boundary is still whole days",
  daysBetween("2026-10-31", "2026-11-02") === 2
);

// --------------------------------------------------------------------------
// Against the database
// --------------------------------------------------------------------------

const createdTasks: string[] = [];
let pieceId: string | null = null;

const cleanup = async () => {
  if (createdTasks.length > 0) {
    await admin.from("practice_tasks").delete().in("id", createdTasks);
  }
  if (pieceId) await admin.from("pieces").delete().eq("id", pieceId);
};

const lastPracticed = async (asOf: string): Promise<string | null> => {
  const { data } = await admin.rpc("piece_last_practiced", {
    as_of_dates: [asOf],
  });
  const row = (data ?? []).find(
    (r: { piece_id: string }) => r.piece_id === pieceId
  );
  return row?.last_practiced ?? null;
};

const addTask = async (fields: Record<string, unknown>) => {
  const { data, error } = await admin
    .from("practice_tasks")
    .insert({ piece_id: pieceId, text: "verify-maintenance", ...fields })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  createdTasks.push(data.id);
  return data.id as string;
};

try {
  console.log("\nThe flag");
  const { data: created, error: pieceErr } = await admin
    .from("pieces")
    .insert({ name: "verify-maintenance piece", composer: "", status: "active" })
    .select("id, maintenance")
    .single();
  check(
    "a new piece starts outside the rotation",
    !pieceErr && created?.maintenance === false,
    pieceErr?.message
  );
  pieceId = created?.id ?? null;

  if (pieceId) {
    await admin.from("pieces").update({ maintenance: true }).eq("id", pieceId);
    const { data: flagged } = await admin
      .from("pieces")
      .select("maintenance, status")
      .eq("id", pieceId)
      .single();
    check(
      "flagging a piece leaves its status alone",
      flagged?.maintenance === true && flagged?.status === "active"
    );

    console.log("\nWhat counts as having practiced something");
    const untouched = await addTask({
      date: "2026-09-15",
      timer_seconds: 900,
      timer_remaining_seconds: 900,
      completed: false,
    });
    check(
      "queueing something and never touching it does not reset the clock",
      (await lastPracticed("2026-09-20")) === null
    );

    await admin
      .from("practice_tasks")
      .update({ timer_remaining_seconds: 899 })
      .eq("id", untouched);
    check(
      "one second on the timer counts",
      (await lastPracticed("2026-09-20")) === "2026-09-15"
    );

    await admin
      .from("practice_tasks")
      .update({ timer_remaining_seconds: 900, completed: true })
      .eq("id", untouched);
    check(
      "archiving with nothing on the clock does not count (the nightly rollover archives everything)",
      (await lastPracticed("2026-09-20")) === null
    );
    await admin
      .from("practice_tasks")
      .update({ timer_remaining_seconds: 899 })
      .eq("id", untouched);

    console.log("\nIt answers for the day you ask about");
    await addTask({
      date: "2026-09-10",
      timer_seconds: 900,
      timer_remaining_seconds: 0,
      completed: true,
    });
    check(
      "asking about today gets the most recent day",
      (await lastPracticed("2026-09-20")) === "2026-09-15"
    );
    check(
      "asking about an earlier day cannot see later practice",
      (await lastPracticed("2026-09-12")) === "2026-09-10"
    );
    check(
      "a day before any practice gets nothing",
      (await lastPracticed("2026-09-05")) === null
    );

    const { data: multi } = await admin.rpc("piece_last_practiced", {
      as_of_dates: ["2026-09-12", "2026-09-20"],
    });
    const mine = (multi ?? []).filter(
      (r: { piece_id: string }) => r.piece_id === pieceId
    );
    check(
      "several days can be asked about at once",
      mine.length === 2 &&
        new Set(mine.map((r: { as_of: string }) => r.as_of)).size === 2
    );

    console.log("\nThe day the practice was for, not the day the row was made");
    check(
      "the answer is the task's own date",
      (await lastPracticed("2026-09-20")) === "2026-09-15"
    );
  }
} finally {
  await cleanup();
}

console.log(
  failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
