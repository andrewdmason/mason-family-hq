// Checks the quick logger's pure logic: how active pieces become cards, which
// task a tap times, and how a card's status line reads. No database needed.
// Run: npx tsx scripts/verify-practice-quick-log.mts

const {
  buildQuickCards,
  daysSinceText,
  formatQuickClock,
  formatQuickTotal,
  parseLogMode,
  pickQuickLogTask,
} = await import("../src/lib/practice/quick-log");
type Piece = import("../src/lib/types").Piece;

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const piece = (
  id: string,
  name: string,
  extra: Partial<Piece> = {}
): Piece => ({
  id,
  work_id: null,
  name,
  composer: null,
  status: "active",
  kind: "piece",
  maintenance: false,
  notes: null,
  target_tempo: null,
  created_at: "",
  updated_at: "",
  ...extra,
});

console.log("\nCards");
const pieces = [
  piece("allegro", "I. Allegro", { work_id: "trio" }),
  piece("andante", "III. Andantino grazioso", { work_id: "trio" }),
  piece("ballade", "Ballade 4", { maintenance: true }),
  piece("rev", "Revolutionary Etude"),
  piece("sight", "Sight Reading", { kind: "sight_reading" }),
  piece("tech", "Technique", { kind: "technique" }),
  piece("lonely", "Lonely movement", { work_id: "solo-work" }),
  piece("scherzo", "Scherzo No. 1", { maintenance: true }),
];
const { current, maintenance } = buildQuickCards(pieces, {
  trio: "Clarinet Trio",
  "solo-work": "Some Sonata",
});
check(
  "technique and sight reading lead, then pieces by name",
  current.map((c) => c.title).join("|") ===
    "Technique|Sight Reading|Clarinet Trio|Lonely movement|Revolutionary Etude",
  current.map((c) => c.title).join("|")
);
const trio = current.find((c) => c.title === "Clarinet Trio");
check(
  "a work with several active pieces is one segmented card, movements in order",
  trio?.pieces.map((p) => p.id).join(",") === "allegro,andante"
);
check(
  "a work with only one active piece is a plain card under the piece's name",
  current.some((c) => c.title === "Lonely movement" && c.pieces.length === 1)
);
check(
  "maintenance pieces get their own group",
  maintenance.map((c) => c.title).join("|") === "Ballade 4|Scherzo No. 1"
);

console.log("\nWhich task a tap times");
const t = (
  id: string,
  completed: boolean,
  at: { started_at?: string; ended_at?: string; created_at?: string } = {}
) => ({
  id,
  completed,
  started_at: at.started_at ?? null,
  ended_at: at.ended_at ?? null,
  created_at: at.created_at ?? "2026-10-09T08:00:00Z",
});
check("nothing today → create one", pickQuickLogTask([]) === null);
check(
  "the first open task wins, in the day's order",
  pickQuickLogTask([t("a", true), t("b", false), t("c", false)])?.id === "b"
);
check(
  "all finished → the one worked on most recently",
  pickQuickLogTask([
    t("a", true, { ended_at: "2026-10-09T18:00:00Z" }),
    t("b", true, { ended_at: "2026-10-09T09:00:00Z" }),
  ])?.id === "a"
);
check(
  "all finished, never timed → the newest",
  pickQuickLogTask([
    t("a", true, { created_at: "2026-10-09T07:00:00Z" }),
    t("b", true, { created_at: "2026-10-09T09:00:00Z" }),
  ])?.id === "b"
);

console.log("\nStatus line");
check("never played", daysSinceText(undefined, "2026-10-09") === "Never played");
check("yesterday", daysSinceText("2026-10-08", "2026-10-09") === "Yesterday");
check("days ago", daysSinceText("2026-09-27", "2026-10-09") === "12 days ago");
check("minutes", formatQuickTotal(45 * 60 + 30) === "45m");
check("hours", formatQuickTotal(76 * 60) === "1h 16m");
check("whole hours", formatQuickTotal(120 * 60) === "2h");
check("live clock", formatQuickClock(247) === "4:07");
check("live clock past an hour", formatQuickClock(4565) === "1:16:05");

console.log("\nMode cookie");
check("quick reads as quick", parseLogMode("quick") === "quick");
check("anything else is the list", parseLogMode(undefined) === "list" && parseLogMode("x") === "list");

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
