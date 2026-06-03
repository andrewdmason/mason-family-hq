// Seeds media that the SQL `db reset` seed can't create, because storage objects
// (the image files) live outside Postgres and must be uploaded through the
// storage API:
//   - photos on the demo journal entries (05_journal_entries) and the family
//     posts (06_family_journal), stored in the private `journal-photos` bucket
//   - profile avatars for each family member, in the `member-photos` bucket
//
// Images are pulled from Lorem Picsum (a stable, key-free public source) so the
// seed is reproducible without committing binaries. Idempotent: each target's
// prior photos are removed (DB rows + storage files) before re-uploading.
//
// Usage: run after `supabase db reset` (or just use `npm run db:reset`, which
// chains both):
//   npm run seed:photos

import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const PHOTOS_BUCKET = "journal-photos";
const MEMBER_PHOTOS_BUCKET = "member-photos";

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
];

// One primary avatar per family member, keyed by email → member-photos bucket
// ({member_email}/{photo_id}.jpg). Shown next to their posts in the family feed.
const MEMBER_AVATARS = [
  { email: "andrew@mason.io", seed: "avatar-andrew" },
  { email: "jenny@mason.io", seed: "avatar-jenny" },
  { email: "oscar@mason.io", seed: "avatar-oscar" },
  { email: "sebastian@mason.io", seed: "avatar-sebastian" },
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

async function main() {
  const { url, serviceKey } = supabaseConfig();
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  console.log("Seeding entry photos…");
  await seedEntryPhotos(supabase);
  console.log("Seeding member avatars…");
  await seedMemberAvatars(supabase);

  console.log("Done seeding journal media.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
