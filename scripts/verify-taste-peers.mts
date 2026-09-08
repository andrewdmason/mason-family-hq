/**
 * The "will I like this?" prediction picks its comparisons by category.
 *
 * These assert the rules that the Bayard case broke: that every book named to
 * the model carries its category, that the candidate's own category reaches the
 * prompt, that a thin genre is admitted as thin rather than dressed up, and —
 * the one that actually caused the bug — that judgements bound to a book's form
 * are forbidden from crossing the fiction line.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-taste-peers.mts
 */

import { buildAssessPrompt, type TasteProfile } from "../src/lib/reading/recommend";

let failures = 0;
function check(label: string, ok: boolean) {
  if (!ok) {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

function title(name: string, genre: string | null, fiction: boolean | null) {
  return { title: name, author: "A", ageAtRating: null, yearsAgo: null, fiction, genre };
}

/** A shelf shaped like the real one: deep in literary fiction, thin elsewhere. */
const profile: TasteProfile = {
  age: 45,
  loved: [
    title("Klara and the Sun", "literary_fiction", true),
    title("Exhalation", "science_fiction", true),
    title("Finding Meaning in the Second Half of Life", "psychology_self", false),
  ],
  liked: [title("The Spy and the Traitor", "history_politics", false)],
  disliked: [],
  didNotFinish: [],
  exclude: [],
  evidence: {
    fiction: 23,
    nonfiction: 6,
    byGenre: { literary_fiction: 12, science_fiction: 5, psychology_self: 1 },
  },
};

console.log("Every book carries its category");
{
  const prompt = buildAssessPrompt(profile, {
    title: "How to Talk About Books You Haven't Read",
    author: "Pierre Bayard",
    fiction: false,
    genre: "philosophy",
  });
  check("loved books are tagged with their genre", prompt.includes("Klara and the Sun by A [Literary fiction]"));
  check("non-fiction on the shelf is tagged too", prompt.includes("[Psychology & self]"));
  check("the candidate's own category reaches the prompt", prompt.includes("Philosophy (non-fiction)"));
}

console.log("\nForm-bound judgements may not cross the fiction line");
{
  const prompt = buildAssessPrompt(profile, {
    title: "How to Talk About Books You Haven't Read",
    author: "Pierre Bayard",
    fiction: false,
    genre: "philosophy",
  });
  check("emotional resonance is named as off-limits across the line", /NEVER carry these across the fiction line[^]*emotional resonance/.test(prompt));
  check('"thin" is named as off-limits across the line', /NEVER carry these across the fiction line[^]*"thin"/.test(prompt));
  check("craft judgements are explicitly allowed across it", /admissible only on craft[^]*prose quality/.test(prompt));
  check("the non-fiction rubric is used, not the fiction one", prompt.includes("ask the non-fiction question"));
  check("the fiction rubric is absent", !prompt.includes("ask the fiction question"));
}

console.log("\nConfidence tracks the evidence");
{
  const thin = buildAssessPrompt(profile, {
    title: "How to Talk About Books You Haven't Read",
    author: "Pierre Bayard",
    fiction: false,
    genre: "philosophy",
  });
  check("a genre with nothing behind it is admitted as thin", thin.includes("genre evidence is thin"));
  check("the actual counts are stated", thin.includes("0 book(s) read in this exact genre"));

  const deep = buildAssessPrompt(profile, {
    title: "A Novel",
    author: "B",
    fiction: true,
    genre: "literary_fiction",
  });
  check("a well-stocked genre is leaned on instead", deep.includes("That's a real same-genre history"));
  check("the deep case is not called thin", !deep.includes("genre evidence is thin"));
  check("the fiction rubric applies to a novel", deep.includes("ask the fiction question"));
}

console.log("\nAn unread shelf is not evidence of dislike");
{
  const prompt = buildAssessPrompt(profile, {
    title: "Anything",
    author: null,
    fiction: null,
    genre: null,
  });
  check("counts are described as read, not owned", prompt.includes("23 fiction and 6 non-fiction books read"));
  check("the unread library is ruled out as a signal", prompt.includes("NOT evidence of dislike"));
  check("absence from the lists may not be argued from", prompt.includes("Never argue from a book's absence"));
  check("an unclassified candidate says so", prompt.includes("uncertain which side of the fiction line"));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
