// Cross-season identity: link a team-scoped GameChanger roster entry to a stable
// person across seasons (R8 boys exact, R9 teammates best-effort).
//
// The registry (people.json) is the source of truth. A player's gc_player_id is
// team-scoped, so the same kid has a different id on every team; aliases map each
// id to a person slug. proposeMatches suggests links for not-yet-aliased players
// by name similarity; the boys resolve to themselves at full-name confidence and
// are never auto-merged with anyone else (different last name => low score).

import { normalizeName, type RosterPlayer } from "./parse";

export type PersonRecord = {
  display_name: string;
  kind: "kid" | "teammate" | "other";
  family_member?: string; // for kind 'kid': resolves user_id via family_members.name
};

export type Registry = {
  people: Record<string, PersonRecord>;
  aliases: Record<string, string>; // gc_player_id -> slug
};

export const AUTO_ACCEPT = 0.9; // essentially a full-name match
export const PROPOSE_FLOOR = 0.5;

// 0..1 name similarity. Full match = 1. First name + last-as-initial (GameChanger
// abbreviates "Oscar Mason" to "Oscar M" on teams you don't score) = 0.9. Same
// last + same first initial = 0.8. Same last only = 0.5. Same first only = 0.4.
// Else token Jaccard.
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = na.split(" ");
  const tb = nb.split(" ");
  const lastA = ta[ta.length - 1];
  const lastB = tb[tb.length - 1];
  const firstA = ta[0];
  const firstB = tb[0];
  // One last name is an initial of the other ("oscar m" ~ "oscar mason").
  const lastInitial = lastA[0] === lastB[0] && (lastA.length === 1 || lastB.length === 1);
  if (firstA === firstB && lastA === lastB) return 1;
  if (firstA === firstB && lastInitial) return 0.9;
  if (lastA === lastB && firstA[0] === firstB[0]) return 0.8;
  if (lastA === lastB) return 0.5;
  if (firstA === firstB) return 0.4;
  const setB = new Set(tb);
  const inter = ta.filter((t) => setB.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union ? (inter / union) * 0.4 : 0;
}

export type Candidate = { slug: string; score: number };
export type Proposal = {
  gc_player_id: string;
  name: string;
  status: "resolved" | "auto" | "proposed" | "new";
  slug: string | null; // resolved/auto: the linked slug; proposed: best suggestion; new: null
  candidates: Candidate[];
};

export function proposeMatches(roster: RosterPlayer[], reg: Registry): Proposal[] {
  const peopleEntries = Object.entries(reg.people);
  return roster.map((player) => {
    const existing = reg.aliases[player.gc_player_id];
    if (existing) {
      return { gc_player_id: player.gc_player_id, name: player.name, status: "resolved", slug: existing, candidates: [] };
    }
    const candidates = peopleEntries
      .map(([slug, rec]) => ({ slug, score: nameSimilarity(player.name, rec.display_name) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);
    const best = candidates[0];
    // Auto-accept only when there is a single dominant full-name match (no
    // near-tie that would signal a genuinely ambiguous same-name case).
    const ambiguous = candidates.length > 1 && candidates[1].score >= AUTO_ACCEPT;
    if (best && best.score >= AUTO_ACCEPT && !ambiguous) {
      return { gc_player_id: player.gc_player_id, name: player.name, status: "auto", slug: best.slug, candidates };
    }
    if (best && best.score >= PROPOSE_FLOOR) {
      return { gc_player_id: player.gc_player_id, name: player.name, status: "proposed", slug: best.slug, candidates };
    }
    return { gc_player_id: player.gc_player_id, name: player.name, status: "new", slug: null, candidates };
  });
}

export function slugify(name: string, taken: Set<string>): string {
  const base = normalizeName(name).replace(/\s+/g, "-") || "player";
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

// Bake a set of decisions into the registry. acceptances: gc_player_id -> slug
// (link to existing person). creations: gc_player_id -> {display_name, kind} for
// brand-new people (slug auto-generated). Returns a new registry (pure).
export function applyDecisions(
  reg: Registry,
  acceptances: Record<string, string>,
  creations: Record<string, { display_name: string; kind?: PersonRecord["kind"] }>,
): Registry {
  const next: Registry = {
    people: { ...reg.people },
    aliases: { ...reg.aliases },
  };
  for (const [gcId, slug] of Object.entries(acceptances)) {
    if (!next.people[slug]) throw new Error(`accept references unknown slug "${slug}"`);
    next.aliases[gcId] = slug;
  }
  const taken = new Set(Object.keys(next.people));
  for (const [gcId, rec] of Object.entries(creations)) {
    const slug = slugify(rec.display_name, taken);
    taken.add(slug);
    next.people[slug] = { display_name: rec.display_name, kind: rec.kind ?? "teammate" };
    next.aliases[gcId] = slug;
  }
  return next;
}

// Non-interactive resolution for autonomous runs: accept 'auto' matches, create
// new people for everyone else (teammates default to new rather than risk a
// wrong merge). Returns the updated registry plus the list of players that were
// newly created so the caller can surface them.
export function autoResolve(
  roster: RosterPlayer[],
  reg: Registry,
): { registry: Registry; autoLinked: Proposal[]; created: Proposal[] } {
  const proposals = proposeMatches(roster, reg);
  const acceptances: Record<string, string> = {};
  const creations: Record<string, { display_name: string }> = {};
  const autoLinked: Proposal[] = [];
  const created: Proposal[] = [];
  for (const p of proposals) {
    if (p.status === "resolved") continue;
    if (p.status === "auto" && p.slug) {
      acceptances[p.gc_player_id] = p.slug;
      autoLinked.push(p);
    } else {
      const name = roster.find((r) => r.gc_player_id === p.gc_player_id)!.name;
      creations[p.gc_player_id] = { display_name: name };
      created.push(p);
    }
  }
  return { registry: applyDecisions(reg, acceptances, creations), autoLinked, created };
}
