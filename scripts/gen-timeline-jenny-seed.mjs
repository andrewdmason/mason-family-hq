// Generate supabase/migrations/00097_timeline_jenny.sql from the authored timeline
// JSON (scripts/timeline-jenny-seed-source.json).
//
// Run:  node scripts/gen-timeline-jenny-seed.mjs
//
// This is the Jenny counterpart to scripts/gen-timeline-seed.mjs (which seeds
// Andrew's timeline into 00094). Two differences from that generator:
//
//   * The implicit subject of every entry is Jenny, not Andrew.
//   * No people are INSERTed. Everyone named in this timeline (Jenny, and Andrew
//     where they share an event) already exists in the people registry seeded by
//     00094, so we reference their fixed UUIDs directly. If a future edit names
//     someone new, this script throws — add them to 00094's people seed first.
//
// The seed is account-independent (no auth.users / user_id), idempotent
// (ON CONFLICT DO NOTHING), and uses fixed UUIDs so dev and prod stay identical.
//
// Subject vs mention rule (same as 00094, fully data-driven): every entry has
// Jenny as a subject; any other FAMILY person named in the entry's `people` is
// also a subject (it's their life event too); every non-family person named is a
// mention.

import { readFileSync, writeFileSync } from "node:fs";

const SRC = "scripts/timeline-jenny-seed-source.json";
const MIGRATION = "supabase/migrations/00097_timeline_jenny.sql";

// The subject whose life this timeline is.
const SUBJECT = "Jenny Gillespie";

// People already in the registry (seeded by 00094). name -> { id, family }.
// "family" people become subjects when they share one of Jenny's events.
const KNOWN_PEOPLE = {
  "Jenny Gillespie": { id: "b0000094-0001-4001-8001-000000000009", family: true },
  "Andrew Mason": { id: "b0000094-0001-4001-8001-000000000001", family: true },
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

function person(name) {
  const p = KNOWN_PEOPLE[name];
  if (!p) throw new Error(`Unknown person "${name}" — add them to 00094's people seed and KNOWN_PEOPLE.`);
  return p;
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
// 00097 namespace so these entry IDs never collide with 00094's.
const entryUuid = (i) => `b0000097-0000-4001-8001-0000000000${pad2(i)}`;

const entries = JSON.parse(readFileSync(SRC, "utf8"));

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

  // Jenny is always a subject; family people in `people` are subjects; the rest mentions.
  const tagged = new Map(); // name -> role  (subject wins over mention)
  tagged.set(SUBJECT, "subject");
  for (const name of e.people || []) {
    const role = person(name).family ? "subject" : "mention";
    if (tagged.get(name) !== "subject") tagged.set(name, role);
  }
  for (const [name, role] of tagged) {
    linkRows.push(`  (${esc(id)}, ${esc(person(name).id)}, ${esc(role)})`);
  }
});

const sql = `-- Jenny Gillespie's timeline: a second subject's life events, layered onto the
-- Timeline shipped in 00094. Same shape as Andrew's seed — dated life events with
-- a category, prominence, normalized dates + precision — but with Jenny as the
-- subject of every row.
--
-- No people are inserted: Jenny (b0000094-0001-...0009) and Andrew
-- (b0000094-0001-...0001) already exist in the people registry from 00094, so we
-- reference their fixed UUIDs. The two events they share ("Recorded music at
-- Electrical Audio", "Left editorial work to pursue poetry and music") tag both as
-- subjects, so those rows surface on both Jenny's and Andrew's timelines from a
-- single canonical entry — exactly the no-duplication design 00094 describes.
--
-- Account-independent and idempotent (ON CONFLICT DO NOTHING) like 00094, so it
-- runs identically in dev and prod. Generated from
-- scripts/timeline-jenny-seed-source.json by scripts/gen-timeline-jenny-seed.mjs —
-- edit the data there and regenerate, don't hand-edit the rows below.

INSERT INTO timeline_entries
  (id, title, description, category, prominence, location, start_date, start_precision, end_date, end_precision, approximate) VALUES
${entryRows.join(",\n")}
ON CONFLICT (id) DO NOTHING;

INSERT INTO timeline_entry_people (timeline_entry_id, person_id, role) VALUES
${linkRows.join(",\n")}
ON CONFLICT (timeline_entry_id, person_id) DO NOTHING;
`;

writeFileSync(MIGRATION, sql);

console.log(
  `Wrote ${MIGRATION}: ${entries.length} entries, ${linkRows.length} tag rows.`
);
