// Generate the seed SQL for supabase/migrations/00094_timeline.sql from the
// authored timeline JSON (scripts/timeline-seed-source.json) and splice it into
// the migration at the `-- @@SEED@@` marker.
//
// Run:  node scripts/gen-timeline-seed.mjs
//
// The seed is account-independent (no auth.users / user_id), idempotent
// (ON CONFLICT DO NOTHING), and uses fixed UUIDs so dev and prod stay identical.
//
// Subject vs mention rule (fully data-driven): every entry has Andrew as a
// subject; any FAMILY person named in the entry's `people` is also a subject
// (it's their life event too); every non-family person named is a mention.

import { readFileSync, writeFileSync } from "node:fs";

const SRC = "scripts/timeline-seed-source.json";
const MIGRATION = "supabase/migrations/00094_timeline.sql";

// Family people -> their family_members email. Andrew is the implicit subject of
// every entry and is added below even though he never appears in a people array.
const FAMILY_EMAIL = {
  "Andrew Mason": "andrew@mason.io",
  "Jenny Gillespie": "jenny@mason.io",
  "Sebastian Mason": "sebastian@mason.io",
  "Oscar Mason": "oscar@mason.io",
};

// The authored JSON uses display labels; the DB stores stable slugs.
const CATEGORY_SLUG = {
  "Origins": "origins",
  "Childhood": "childhood",
  "Education": "education",
  "Career": "career",
  "Recognition & Creative Work": "recognition",
  "Relationships": "relationships",
  "Children & Family": "children_family",
  "Homes & Relocation": "homes",
  "Travel & Adventure": "travel",
  "Music & Hobbies": "music_hobbies",
  "Health & Hard Times": "health_hard_times",
};

const PROMINENCE = new Set(["major", "medium", "minor"]);

const esc = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);

function categorySlug(label) {
  const slug = CATEGORY_SLUG[label];
  if (!slug) throw new Error(`Unknown category label: ${label}`);
  return slug;
}

// "1986" -> year/1986-01-01 ; "1999-06" -> month/1999-06-01 ; "2006-03-17" -> day
function parseDate(raw) {
  if (!raw) return null;
  if (/^\d{4}$/.test(raw)) return { date: `${raw}-01-01`, precision: "year" };
  if (/^\d{4}-\d{2}$/.test(raw)) return { date: `${raw}-01`, precision: "month" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { date: raw, precision: "day" };
  throw new Error(`Unparseable date: ${raw}`);
}

const isApproximate = (d) => /placeholder|double-check|worth a quick/i.test(d || "");

const pad2 = (n) => String(n).padStart(2, "0");
const entryUuid = (i) => `b0000094-0000-4001-8001-0000000000${pad2(i)}`;
const personUuid = (i) => `b0000094-0001-4001-8001-0000000000${pad2(i)}`;

const entries = JSON.parse(readFileSync(SRC, "utf8"));

// Build the distinct people registry: everyone named anywhere, plus Andrew.
const names = ["Andrew Mason", ...entries.flatMap((e) => e.people || [])];
const distinct = [...new Set(names)];
const personId = new Map(distinct.map((name, i) => [name, personUuid(i + 1)]));

// --- people INSERT ---
const peopleRows = distinct
  .map((name) => `  (${esc(personId.get(name))}, ${esc(name)}, ${esc(FAMILY_EMAIL[name] ?? null)})`)
  .join(",\n");

// --- timeline_entries + timeline_entry_people INSERTs ---
const entryRows = [];
const linkRows = [];
entries.forEach((e, idx) => {
  const id = entryUuid(idx + 1);
  const start = parseDate(e.start_date);
  const end = parseDate(e.end_date);
  if (!start) throw new Error(`Entry "${e.title}" has no start_date`);
  if (!PROMINENCE.has(e.prominence)) throw new Error(`Bad prominence: ${e.prominence}`);
  entryRows.push(
    `  (${esc(id)}, ${esc(e.title)}, ${esc(e.description)}, ${esc(categorySlug(e.category))}, ${esc(
      e.prominence
    )}, ${esc(e.location)}, ${esc(start.date)}, ${esc(start.precision)}, ${
      end ? esc(end.date) : "NULL"
    }, ${end ? esc(end.precision) : "NULL"}, ${isApproximate(e.description)})`
  );

  // Andrew is always a subject; family people in `people` are subjects; the rest mentions.
  const tagged = new Map(); // name -> role  (subject wins over mention)
  tagged.set("Andrew Mason", "subject");
  for (const name of e.people || []) {
    const role = FAMILY_EMAIL[name] ? "subject" : "mention";
    if (tagged.get(name) !== "subject") tagged.set(name, role);
  }
  for (const [name, role] of tagged) {
    linkRows.push(`  (${esc(id)}, ${esc(personId.get(name))}, ${esc(role)})`);
  }
});

const seed = `INSERT INTO people (id, name, member_email) VALUES
${peopleRows}
ON CONFLICT (id) DO NOTHING;

INSERT INTO timeline_entries
  (id, title, description, category, prominence, location, start_date, start_precision, end_date, end_precision, approximate) VALUES
${entryRows.join(",\n")}
ON CONFLICT (id) DO NOTHING;

INSERT INTO timeline_entry_people (timeline_entry_id, person_id, role) VALUES
${linkRows.join(",\n")}
ON CONFLICT (timeline_entry_id, person_id) DO NOTHING;`;

const migration = readFileSync(MIGRATION, "utf8");
if (!migration.includes("-- @@SEED@@")) {
  throw new Error("Marker -- @@SEED@@ not found (already generated?). Restore it to regenerate.");
}
writeFileSync(MIGRATION, migration.replace("-- @@SEED@@", seed));

console.log(
  `Spliced seed: ${distinct.length} people, ${entries.length} entries, ${linkRows.length} tag rows.`
);
