// One-time generator (provenance) for the committed reading seed fixture
// supabase/fixtures/jekyll-hyde-pages.json — a public-domain book (Project
// Gutenberg #43, "The Strange Case of Dr. Jekyll and Mr. Hyde", Robert Louis
// Stevenson) paginated into ~130 pages so the reading seed has a real,
// page-mapped book to exercise the quiz-progression flow. Re-run with `node`
// only if you want to regenerate the fixture.
import { writeFileSync } from "node:fs";

const SRC = "https://www.gutenberg.org/cache/epub/43/pg43.txt";
const PAGE_CHAR_BUDGET = 900; // tuned to land near ~130 pages

const res = await fetch(SRC);
if (!res.ok) throw new Error(`fetch ${SRC} failed: ${res.status}`);
let raw = (await res.text()).replace(/\r/g, "");

// Strip Project Gutenberg license header/footer.
const start = raw.indexOf("*** START OF THE PROJECT GUTENBERG EBOOK");
const end = raw.indexOf("*** END OF THE PROJECT GUTENBERG EBOOK");
if (start === -1 || end === -1) throw new Error("PG markers not found");
let body = raw.slice(raw.indexOf("\n", start) + 1, end).trim();

// Paragraphs: blank-line separated; unwrap hard-wrapped lines within each.
const paragraphs = body
  .split(/\n\s*\n/)
  .map((p) => p.replace(/\s*\n\s*/g, " ").replace(/[ \t]+/g, " ").trim())
  .filter(Boolean);

// Pack whole paragraphs into pages up to the char budget.
const pages = [];
let buf = [];
let len = 0;
for (const p of paragraphs) {
  if (len > 0 && len + p.length + 2 > PAGE_CHAR_BUDGET) {
    pages.push(buf.join("\n\n"));
    buf = [];
    len = 0;
  }
  buf.push(p);
  len += p.length + 2;
}
if (buf.length) pages.push(buf.join("\n\n"));

writeFileSync(
  "supabase/fixtures/jekyll-hyde-pages.json",
  JSON.stringify(pages, null, 0) + "\n"
);

const totalChars = pages.reduce((n, p) => n + p.length, 0);
console.log(
  `pages=${pages.length} totalChars=${totalChars} avgPageChars=${Math.round(
    totalChars / pages.length
  )} paragraphs=${paragraphs.length}`
);
