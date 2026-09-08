/**
 * One real "will I like this?" prediction, against the API.
 *
 * Not a test — a smoke check that costs a fraction of a cent. It runs the
 * assessment over a shelf shaped like a real one (deep in literary fiction,
 * thin in non-fiction) and prints the verdict, the reasoning and the peer set
 * it says it used, so the thing that can only be judged by reading it — whether
 * the prediction compares like with like — can actually be read.
 *
 * The first case is the one that prompted the work: a book of literary theory
 * that the old prompt graded against the reader's favourite novels and called
 * "could go either way".
 *
 *   npx tsx --tsconfig scripts/tsconfig.json --env-file-if-exists=.env.local scripts/smoke-assess-book.mts
 */

import { assessBookFit, type TasteProfile } from "../src/lib/reading/recommend";

const t = (
  title: string,
  author: string,
  fiction: boolean,
  genre: string
) => ({ title, author, ageAtRating: null, yearsAgo: null, fiction, genre });

const profile: TasteProfile = {
  age: 45,
  loved: [
    t("Crossroads", "Jonathan Franzen", true, "literary_fiction"),
    t("East of Eden", "John Steinbeck", true, "literary_fiction"),
    t("Klara and the Sun", "Kazuo Ishiguro", true, "literary_fiction"),
    t("Stoner", "John Williams", true, "literary_fiction"),
    t("The Remains of the Day", "Kazuo Ishiguro", true, "literary_fiction"),
    t("The Unconsoled", "Kazuo Ishiguro", true, "literary_fiction"),
    t("The Wind-Up Bird Chronicle", "Haruki Murakami", true, "literary_fiction"),
    t("Lolita", "Vladimir Nabokov", true, "literary_fiction"),
    t("Exhalation", "Ted Chiang", true, "short_stories"),
    t("The Three-Body Problem", "Cixin Liu", true, "science_fiction"),
    t("Dune", "Frank Herbert", true, "science_fiction"),
    t("Great Expectations", "Charles Dickens", true, "classics"),
    t("Finding Meaning in the Second Half of Life", "James Hollis", false, "psychology_self"),
    t("He", "Robert A. Johnson", false, "psychology_self"),
    t("The Grace in Dying", "Kathleen Dowling Singh", false, "health_mortality"),
    t("Moonwalking with Einstein", "Joshua Foer", false, "science"),
  ],
  liked: [
    t("My Struggle: Book 1", "Karl Ove Knausgaard", false, "biography_memoir"),
    t("The Spy and the Traitor", "Ben Macintyre", false, "history_politics"),
    t("A World Appears", "Michael Pollan", false, "science"),
    t("A Game of Thrones", "George R. R. Martin", true, "fantasy"),
  ],
  disliked: [t("The Overstory", "Richard Powers", true, "literary_fiction")],
  didNotFinish: [
    t("Blindsight", "Peter Watts", true, "science_fiction"),
    t("Children of Time", "Adrian Tchaikovsky", true, "science_fiction"),
  ],
  exclude: [],
  evidence: {
    fiction: 23,
    nonfiction: 6,
    byGenre: {
      literary_fiction: 12,
      science_fiction: 5,
      classics: 2,
      short_stories: 2,
      fantasy: 2,
      psychology_self: 1,
      biography_memoir: 2,
      science: 1,
      health_mortality: 1,
    },
  },
};

const CASES = [
  {
    title: "How to Talk About Books You Haven't Read",
    author: "Pierre Bayard",
    fiction: false,
    genre: "philosophy",
  },
  // A novel in his deepest genre — the case where confidence is earned.
  { title: "Gilead", author: "Marilynne Robinson", fiction: true, genre: "literary_fiction" },
  // Non-fiction squarely in the attractors his shelf actually shows.
  { title: "Being Mortal", author: "Atul Gawande", fiction: false, genre: "health_mortality" },
];

for (const book of CASES) {
  const result = await assessBookFit(profile, book);
  console.log(`\n─── ${book.title} — ${book.author}`);
  if (!result) {
    console.log("  (no verdict)");
    continue;
  }
  console.log(`  verdict: ${result.verdict}`);
  console.log(`  basis:   ${result.basis ?? "(none)"}`);
  console.log(`  reason:  ${result.reason}`);
  const sentences = result.reason.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  console.log(`  (${sentences} sentences, ${result.reason.length} chars)`);
}
