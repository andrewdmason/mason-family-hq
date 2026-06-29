// Headless verification for the identity matcher (U3).
// Run: npx tsx scripts/verify-baseball-identity.mts
//
// Pure — no DB, no network. Exercises identity.ts against the seeded registry.

import {
  proposeMatches,
  applyDecisions,
  autoResolve,
  nameSimilarity,
  type Registry,
} from "./baseball/identity";
import type { RosterPlayer } from "./baseball/parse";

// Fixed seed (the two boys), independent of the live people.json which fills up
// with real teammates as seasons are imported.
const baseRegistry = (): Registry => ({
  people: {
    oscar: { display_name: "Oscar Mason", kind: "kid", family_member: "Oscar" },
    sebastian: { display_name: "Sebastian Mason", kind: "kid", family_member: "Sebastian" },
  },
  aliases: {},
});

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
}

const p = (gc_player_id: string, name: string, jersey: string | null = null): RosterPlayer => ({ gc_player_id, name, jersey });

// ---- boys resolve exactly, never cross-merge ----
console.log("boys: exact match, no cross-merge");
{
  const reg = baseRegistry();
  const props = proposeMatches([p("gc-seb-A", "Sebastian Mason"), p("gc-osc-A", "Oscar Mason")], reg);
  const seb = props.find((x) => x.gc_player_id === "gc-seb-A")!;
  const osc = props.find((x) => x.gc_player_id === "gc-osc-A")!;
  check("Sebastian Mason auto-links to 'sebastian'", seb.status === "auto" && seb.slug === "sebastian", seb);
  check("Oscar Mason auto-links to 'oscar'", osc.status === "auto" && osc.slug === "oscar", osc);
  check("Sebastian not merged into 'oscar' (oscar only a 0.5 candidate)",
    seb.candidates.find((c) => c.slug === "oscar")!.score === 0.5);
}

// ---- abbreviated roster name ("Oscar M") links to the boy ----
console.log("abbreviated 'Oscar M' roster name links to oscar");
{
  const reg = baseRegistry();
  const props = proposeMatches([p("gc-oscm", "Oscar M")], reg);
  check("Oscar M auto-links to oscar by last-initial", props[0].status === "auto" && props[0].slug === "oscar", props[0]);
  check("nameSimilarity('Oscar M','Oscar Mason') = 0.9", nameSimilarity("Oscar M", "Oscar Mason") === 0.9);
}

// ---- AE2: same boy across two teams -> one slug ----
console.log("AE2: same boy across teams collapses to one identity");
{
  let reg = baseRegistry();
  reg = autoResolve([p("gc-seb-team1", "Sebastian Mason")], reg).registry;
  const props2 = proposeMatches([p("gc-seb-team2", "Sebastian Mason")], reg);
  check("team1 id aliased to sebastian", reg.aliases["gc-seb-team1"] === "sebastian");
  check("team2 (different gc id) still resolves to sebastian",
    props2[0].slug === "sebastian" && (props2[0].status === "auto"), props2[0]);
}

// ---- AE3: teammate two spellings proposed same; rejecting keeps two ----
console.log("AE3: recurring teammate linking + rejection");
{
  let reg = baseRegistry();
  // First team introduces the teammate as a new person.
  reg = autoResolve([p("gc-jack-1", "Jack Jones")], reg).registry;
  const jackSlug = reg.aliases["gc-jack-1"];
  check("teammate created as new person", !!jackSlug && reg.people[jackSlug].kind === "teammate");
  // Second team, slightly different spacing -> proposed as the same person.
  const props = proposeMatches([p("gc-jack-2", "Jack  Jones")], reg);
  check("second spelling proposed/auto as same person", props[0].slug === jackSlug, props[0]);
  // Rejecting the link -> create a separate person instead.
  const rejected = applyDecisions(reg, {}, { "gc-jack-2": { display_name: "Jack Jones" } });
  check("rejection yields two distinct people", rejected.aliases["gc-jack-2"] !== jackSlug &&
    Object.values(rejected.people).filter((x) => x.display_name === "Jack Jones").length === 2);
}

// ---- edge: two different kids, same first name, not auto-merged ----
console.log("edge: same first name, different last -> not merged");
{
  let reg = baseRegistry();
  reg = applyDecisions(reg, {}, { "gc-jj": { display_name: "Jack Jones" } });
  const props = proposeMatches([p("gc-js", "Jack Smith")], reg);
  check("Jack Smith not auto-linked to Jack Jones", props[0].status !== "auto", props[0]);
  check("Jack Smith treated as new (score 0.4 < propose floor)", props[0].status === "new", props[0]);
}

// ---- edge: genuinely ambiguous identical names -> proposed, not auto ----
console.log("edge: identical names -> ambiguous, not auto");
{
  let reg = baseRegistry();
  reg = applyDecisions(reg, {}, { "gc-sam1": { display_name: "Sam Lee" } });
  reg = applyDecisions(reg, {}, { "gc-sam2": { display_name: "Sam Lee" } });
  const props = proposeMatches([p("gc-sam3", "Sam Lee")], reg);
  check("third Sam Lee is ambiguous -> not auto", props[0].status === "proposed", props[0]);
}

// ---- edge: unknown player, no near match -> new ----
console.log("edge: unknown player -> new");
{
  const reg = baseRegistry();
  const props = proposeMatches([p("gc-x", "Zephyr Quillborn")], reg);
  check("no candidate -> new", props[0].status === "new" && props[0].candidates.length === 0, props[0]);
}

// ---- autoResolve splits auto-linked vs created ----
console.log("autoResolve: boys linked, teammates created");
{
  const reg = baseRegistry();
  const { registry, autoLinked, created } = autoResolve(
    [p("gc-seb", "Sebastian Mason"), p("gc-mate", "Marc Hauser")],
    reg,
  );
  check("Sebastian auto-linked", autoLinked.some((x) => x.slug === "sebastian"));
  check("Marc Hauser created new", created.some((x) => x.name === "Marc Hauser"));
  check("registry now resolves both", !!registry.aliases["gc-seb"] && !!registry.aliases["gc-mate"]);
}

// ---- applyDecisions guards ----
console.log("guards + similarity");
{
  const reg = baseRegistry();
  let threw = false;
  try { applyDecisions(reg, { "gc-z": "nonexistent-slug" }, {}); } catch { threw = true; }
  check("accept to unknown slug throws", threw);
  check("identical names score 1", nameSimilarity("Sebastian Mason", "sebastian  mason") === 1);
}

console.log("");
if (failures > 0) { console.error(`FAILED: ${failures} check(s)`); process.exit(1); }
console.log("All baseball identity checks passed.");
