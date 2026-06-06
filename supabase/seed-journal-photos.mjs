// Seeds media that the SQL `db reset` seed can't create, because storage objects
// (the image files) live outside Postgres and must be uploaded through the
// storage API:
//   - photos on the demo journal entries (05_journal_entries) and the family
//     posts (06_family_journal), stored in the private `journal-photos` bucket
//   - profile avatars for each family member, in the `member-photos` bucket
//   - one original demo book's converted HTML, in the `reading-books` bucket, so
//     the owner "Generate quiz" -> review -> publish flow is available after reset
//
// Images are pulled from Lorem Picsum (a stable, key-free public source) so the
// seed is reproducible without committing binaries. Idempotent: each target's
// prior photos are removed (DB rows + storage files) before re-uploading.
//
// Usage: run after `supabase db reset` (or just use `npm run db:reset`, which
// chains both):
//   npm run seed:photos

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const PHOTOS_BUCKET = "journal-photos";
const MEMBER_PHOTOS_BUCKET = "member-photos";
const READING_BOOKS_BUCKET = "reading-books";
const READING_GENERATE_BOOK_ID = "a0000003-0004-4001-8001-000000000011";
// Oscar's public-domain demo book (Project Gutenberg #43), seeded with a real
// page map + an active check-in quiz from 07_reading_oscar_jekyll.sql. Its
// converted text lives in supabase/fixtures/jekyll-hyde-pages.json.
const JEKYLL_BOOK_ID = "a0000003-0005-4001-8001-000000000001";

// Entries to attach photos to, by fixed id (from the SQL seeds). The owning
// user_id is resolved per entry from the DB, so paths land under the right member
// ({user_id}/{entry_id}/...) — owner demo entries and family posts alike. `seed`
// makes each Picsum image deterministic.
const ENTRIES = [
  // Owner demo entries (05_journal_entries.sql)
  { id: "f0000001-0001-4001-8001-000000000001", photos: [{ seed: "journal-morning-coffee" }, { seed: "journal-window-light" }] },
  { id: "f0000001-0001-4001-8001-000000000002", photos: [{ seed: "journal-sheet-music" }] },
  { id: "f0000001-0001-4001-8001-000000000003", photos: [{ seed: "journal-piano-keys" }, { seed: "journal-evening-practice" }] },
  // Family posts (06_family_journal.sql)
  { id: "a0000002-0001-4001-8001-000000000001", photos: [{ seed: "family-redwoods" }, { seed: "family-campfire" }] }, // Jenny — camping
  { id: "a0000002-0002-4001-8001-000000000001", photos: [{ seed: "family-volcano" }] }, // Oscar — volcano
  { id: "a0000002-0003-4001-8001-000000000001", photos: [{ seed: "family-soccer" }] }, // Sebastian — soccer
  // Timeline-linked dev posts (08_timeline_dev.sql)
  { id: "c0000002-0001-4001-8001-000000000002", photos: [{ seed: "jenny-album-studio" }, { seed: "jenny-album-cover" }] }, // Jenny — debut album
  { id: "c0000002-0003-4001-8001-000000000002", photos: [{ seed: "sebastian-first-book" }] }, // Sebastian — first chapter book
  // Early-life reflections (08_timeline_dev.sql, second block) — images on the
  // 1980s–90s end of the timeline.
  { id: "c0000002-0000-4001-8001-000000000001", photos: [{ seed: "andrew-born-pittsburgh" }, { seed: "mtlebanon-house" }] }, // Andrew — born
  { id: "c0000002-0000-4001-8001-000000000002", photos: [{ seed: "andrew-child-piano" }] }, // Andrew — piano
  { id: "c0000002-0000-4001-8001-000000000003", photos: [{ seed: "bagel-delivery-kid" }] }, // Andrew — hustles
  { id: "c0000002-0000-4001-8001-000000000004", photos: [{ seed: "fugazi-basement-show" }] }, // Andrew — Fugazi
  { id: "c0000002-0000-4001-8001-000000000005", photos: [{ seed: "mtlebanon-graduation" }] }, // Andrew — HS graduation
  { id: "c0000002-0001-4001-8001-000000000003", photos: [{ seed: "jenny-born-chicago" }] }, // Jenny — born
];

// One primary avatar per family member, keyed by email → member-photos bucket
// ({member_email}/{photo_id}.jpg). Shown next to their posts in the family feed.
const MEMBER_AVATARS = [
  { email: "andrew@mason.io", seed: "avatar-andrew" },
  { email: "jenny@mason.io", seed: "avatar-jenny" },
  { email: "oscar@mason.io", seed: "avatar-oscar" },
  { email: "sebastian@mason.io", seed: "avatar-sebastian" },
];

// Original demo text written for local development. It is intentionally not a
// real copyrighted book, but it behaves like a converted EPUB/PDF for the quiz
// generator: page anchors, char ranges, ready content row, and storage objects.
const MAPMAKER_PAGES = [
  "Lena found the brass lantern in the back room of her grandfather's map shop, behind rolled charts of rivers that no longer kept their old names. A note tied to the handle said, Light this only when the road refuses to show itself.",
  "The next morning, the harbor fog was so thick that even the bell tower sounded lost. Grandfather had promised to deliver a map to the hill village before sundown, but his ankle was wrapped in linen and propped on a crate.",
  "Lena wanted to prove she could handle more than sweeping pencil shavings. She packed the new map, a heel of bread, a compass, and the lantern, though she told herself she would not need anything as mysterious as a lamp to follow a road.",
  "At the north gate, the road forked into three muddy lanes. The compass needle shivered, spun once, and pointed straight at a stone wall. Lena almost turned back, but then she remembered the note and struck a match.",
  "The lantern flame burned blue instead of gold. On the wall, lines appeared like ink spreading across paper. They showed a narrow stair hidden under ivy, climbing to a ridge path Lena had never seen on any map in the shop.",
  "Halfway up the ridge, Lena met Tomas, a shepherd looking for three missing goats. He said the ridge path was called the Listener's Way because careless travelers heard only echoes, while patient ones heard what the mountain wanted them to notice.",
  "Lena was in too much of a hurry to be patient. She hurried ahead, slipped on wet moss, and dropped the map tube. It rolled toward a crack between two rocks and stopped only because Tomas hooked it with his crook.",
  "Tomas did not scold her. He only asked what kind of mapmaker ignored the ground under her feet. Lena felt heat in her face because the answer was obvious: the kind who cared more about arriving than understanding the path.",
  "They walked together until the fog thinned. Below them, a dry streambed twisted through the valley like a pale ribbon. The lantern flickered, and Lena saw tiny blue sparks marking hoofprints beside the stones.",
  "The goats were trapped near an old footbridge where one plank had snapped. Lena wanted to rush across, but Tomas knelt first and tested each board. Together they tied the goats with rope and led them back one careful step at a time.",
  "By noon, the sky cleared enough to reveal storm clouds gathering over the western cliffs. Tomas offered to show Lena a shortcut, but he warned that shortcuts charged a price: you had to give them your full attention.",
  "The shortcut entered a grove of silver-leaf trees. Every trunk looked alike, and the path vanished under fallen needles. Lena raised the lantern, expecting it to draw a simple line, but instead it lit three possible ways.",
  "One path smelled of rain. One path carried the sound of village bells. The last path showed fresh scratches on the bark, as if someone had dragged a heavy cart through recently. Lena closed her eyes and listened.",
  "The bells were only an echo from the valley, and the rainy path led toward the storm. The scratched trees pointed toward wagon wheels and, she hoped, the village road. For the first time all day, she chose slowly.",
  "Her choice brought them to a broken milestone. The carved arrow had fallen face-down in the grass. Lena cleaned the mud from it and saw that it named the hill village, but the arrow pointed back the way she had come.",
  "Tomas laughed softly and turned the stone around. He explained that maps were promises, but roads were conversations. If people moved a sign, a good traveler had to notice, question, and correct it.",
  "Near the village, they found a merchant sitting beside a cart with a cracked wheel. He was the one who had dragged the cart through the grove. Lena helped him mark the safest route around the broken bridge on the edge of her spare paper.",
  "When Lena finally reached the hill village, the mayor was waiting outside the schoolhouse. The map she delivered showed wells, orchards, and winter paths, but Lena added one new mark in pencil: bridge unsafe after rain.",
  "The mayor thanked her for the map and for the warning. Children gathered around to see the blue lantern, but Lena covered its glass. She had learned that the lantern was helpful only when she was willing to look carefully without it first.",
  "On the way home, Tomas asked whether she still wanted to become a mapmaker. Lena said yes, but not the kind who drew roads from a desk and never muddy boots. She wanted maps that remembered mistakes and helped the next traveler.",
  "Grandfather was awake when she returned after dark. Before asking about the delivery, he looked at her scratched hands, muddy hem, and steady eyes. Then he asked what the road had taught her.",
  "Lena told him about the hidden stair, the goats, the false bells, the turned milestone, and the broken bridge. She admitted that she had nearly lost the map because she hurried instead of watching.",
  "Grandfather placed the blue lantern back on its hook. He said the lantern did not reveal roads to people who wanted magic to replace judgment. It helped people who were already trying to pay attention.",
  "The next week, Lena drew a new practice map of the ridge path. In the corner, where other mapmakers wrote a scale or compass rose, she wrote a reminder for herself: The best map begins with listening.",
];

function supabaseConfig() {
  const status = JSON.parse(
    execSync("npx supabase status -o json", { encoding: "utf8" })
  );
  if (!status.API_URL || !status.SERVICE_ROLE_KEY) {
    throw new Error("Could not read local Supabase status. Is it running?");
  }
  return { url: status.API_URL, serviceKey: status.SERVICE_ROLE_KEY };
}

async function fetchImage(seed, width, height) {
  const url = `https://picsum.photos/seed/${seed}/${width}/${height}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function seedEntryPhotos(supabase) {
  for (const entry of ENTRIES) {
    // Resolve the entry's owner so storage paths match the app's RLS-scoped
    // signed URLs: {user_id}/{entry_id}/{photo_id}-*.jpg.
    const { data: row } = await supabase
      .from("journal_entries")
      .select("user_id")
      .eq("id", entry.id)
      .maybeSingle();
    if (!row?.user_id) {
      console.log(`  skipped ${entry.id} (no such entry — run db reset first)`);
      continue;
    }
    const userId = row.user_id;

    // Idempotent: clear any previously seeded photos for this entry.
    const { data: existing } = await supabase
      .from("journal_entry_photos")
      .select("original_path, display_path")
      .eq("entry_id", entry.id);
    if (existing?.length) {
      const paths = existing.flatMap((p) => [p.original_path, p.display_path]);
      await supabase.storage.from(PHOTOS_BUCKET).remove(paths);
      await supabase.from("journal_entry_photos").delete().eq("entry_id", entry.id);
    }

    for (const photo of entry.photos) {
      const photoId = crypto.randomUUID();
      const originalPath = `${userId}/${entry.id}/${photoId}-original.jpg`;
      const displayPath = `${userId}/${entry.id}/${photoId}-display.jpg`;

      const original = await fetchImage(photo.seed, 3000, 2000);
      const display = await fetchImage(photo.seed, 2000, 1333);

      const up1 = await supabase.storage
        .from(PHOTOS_BUCKET)
        .upload(originalPath, original, { contentType: "image/jpeg", upsert: true });
      if (up1.error) throw up1.error;

      const up2 = await supabase.storage
        .from(PHOTOS_BUCKET)
        .upload(displayPath, display, { contentType: "image/jpeg", upsert: true });
      if (up2.error) throw up2.error;

      const { error: insErr } = await supabase
        .from("journal_entry_photos")
        .insert({
          entry_id: entry.id,
          user_id: userId,
          original_path: originalPath,
          display_path: displayPath,
        });
      if (insErr) throw insErr;

      console.log(`  attached ${photo.seed} to ${entry.id}`);
    }
  }
}

async function seedMemberAvatars(supabase) {
  for (const avatar of MEMBER_AVATARS) {
    // The member must exist (00_dev_family.sql / first sign-in).
    const { data: member } = await supabase
      .from("family_members")
      .select("email")
      .eq("email", avatar.email)
      .maybeSingle();
    if (!member) {
      console.log(`  skipped avatar for ${avatar.email} (no member row)`);
      continue;
    }

    // Idempotent: clear any previously seeded avatars for this member.
    const { data: existing } = await supabase
      .from("journal_member_photos")
      .select("storage_path")
      .eq("member_email", avatar.email);
    if (existing?.length) {
      await supabase.storage
        .from(MEMBER_PHOTOS_BUCKET)
        .remove(existing.map((p) => p.storage_path));
      await supabase
        .from("journal_member_photos")
        .delete()
        .eq("member_email", avatar.email);
    }

    const photoId = crypto.randomUUID();
    const storagePath = `${avatar.email}/${photoId}.jpg`;
    const image = await fetchImage(avatar.seed, 400, 400);

    const up = await supabase.storage
      .from(MEMBER_PHOTOS_BUCKET)
      .upload(storagePath, image, { contentType: "image/jpeg", upsert: true });
    if (up.error) throw up.error;

    const { error: insErr } = await supabase
      .from("journal_member_photos")
      .insert({ member_email: avatar.email, storage_path: storagePath, is_primary: true });
    if (insErr) throw insErr;

    console.log(`  set avatar for ${avatar.email}`);
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildPagedHtml(pages, title) {
  let charOffset = 0;
  const pageRows = [];
  const blocks = pages.map((text, index) => {
    const pageNumber = index + 1;
    const anchorId = `page-${pageNumber}`;
    const charStart = charOffset;
    charOffset += text.length + 1;
    pageRows.push({
      page_number: pageNumber,
      anchor_id: anchorId,
      char_start: charStart,
      char_end: charOffset,
    });
    return `<span id="${anchorId}"></span>\n<p>${escapeHtml(text)}</p>`;
  });

  return {
    html: [
      "<!doctype html>",
      "<html>",
      "<head>",
      '<meta charset="utf-8">',
      `<title>${escapeHtml(title)}</title>`,
      "</head>",
      "<body>",
      ...blocks,
      "</body>",
      "</html>",
    ].join("\n"),
    pageRows,
    charCount: charOffset,
  };
}

// Seed one converted book's storage objects (source placeholder + content.html)
// and its content/page-map rows, so the quiz flows have ready, page-scoped text.
// The book row itself comes from the SQL seeds; this fills in what storage can't.
async function seedConvertedBook(supabase, { bookId, title, pages }) {
  const { data: book } = await supabase
    .from("reading_books")
    .select("id, user_id")
    .eq("id", bookId)
    .maybeSingle();
  if (!book?.user_id) {
    console.log(`  skipped "${title}" content (no such book)`);
    return;
  }

  const userId = book.user_id;
  const sourcePath = `${userId}/${bookId}/source.epub`;
  const contentPath = `${userId}/${bookId}/content.html`;
  const { html, pageRows, charCount } = buildPagedHtml(pages, title);

  const source = Buffer.from(
    "Synthetic local-dev EPUB placeholder. Converted content is seeded as content.html.\n",
    "utf8"
  );
  const sourceUpload = await supabase.storage
    .from(READING_BOOKS_BUCKET)
    .upload(sourcePath, source, {
      contentType: "application/octet-stream",
      upsert: true,
    });
  if (sourceUpload.error) throw sourceUpload.error;

  const contentUpload = await supabase.storage
    .from(READING_BOOKS_BUCKET)
    .upload(contentPath, Buffer.from(html, "utf8"), {
      contentType: "text/html",
      upsert: true,
    });
  if (contentUpload.error) throw contentUpload.error;

  const { error: contentErr } = await supabase.from("reading_book_content").upsert(
    {
      book_id: bookId,
      user_id: userId,
      source_format: "epub",
      source_path: sourcePath,
      content_path: contentPath,
      status: "ready",
      error_message: null,
      page_count: pages.length,
      has_real_pages: true,
      char_count: charCount,
      toc: [{ title, anchorId: "page-1", level: 1, page: 1 }],
    },
    { onConflict: "book_id" }
  );
  if (contentErr) throw contentErr;

  await supabase.from("reading_book_pages").delete().eq("book_id", bookId);

  const { error: pagesErr } = await supabase.from("reading_book_pages").insert(
    pageRows.map((page) => ({ book_id: bookId, user_id: userId, ...page }))
  );
  if (pagesErr) throw pagesErr;

  console.log(`  uploaded converted content for "${title}" (${pages.length} pages)`);
}

// The paginated public-domain text of Jekyll & Hyde, committed as a fixture so
// resets need no network for the book (see scripts/build-jekyll-fixture.mjs).
function jekyllPages() {
  return JSON.parse(
    readFileSync(
      new URL("./fixtures/jekyll-hyde-pages.json", import.meta.url),
      "utf8"
    )
  );
}

async function main() {
  const { url, serviceKey } = supabaseConfig();
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  console.log("Seeding entry photos…");
  await seedEntryPhotos(supabase);
  console.log("Seeding member avatars…");
  await seedMemberAvatars(supabase);
  console.log("Seeding reading demo content…");
  await seedConvertedBook(supabase, {
    bookId: READING_GENERATE_BOOK_ID,
    title: "The Mapmaker's Lantern",
    pages: MAPMAKER_PAGES,
  });
  await seedConvertedBook(supabase, {
    bookId: JEKYLL_BOOK_ID,
    title: "The Strange Case of Dr. Jekyll and Mr. Hyde",
    pages: jekyllPages(),
  });

  console.log("Done seeding dev media.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
