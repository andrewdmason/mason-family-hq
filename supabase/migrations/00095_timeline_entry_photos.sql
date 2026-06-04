-- Photos pinned directly to a timeline event — no journal post required.
--
-- Earlier, "add a photo to an event" created an empty journal entry just to hold
-- the photo (cover came from that linked post). That cluttered the journal feed
-- with contentless posts. Instead, photos are now a first-class property of the
-- event: this table mirrors journal_entry_photos but is keyed to a timeline event.
--
-- Storage reuses the existing `journal-photos` bucket — files live under
-- {auth.uid()}/timeline/{event_id}/{photo_id}-*.jpg, so the bucket's per-user
-- folder RLS already governs uploads/reads, and the owner-admin signing path in
-- getTimelineEntriesPhotos lets the account owner see every member's photos.
--
-- The event's cover/photos are the UNION of these directly-pinned photos and any
-- photos on journal reflections linked to the event (derived at read time).

CREATE TABLE timeline_entry_photos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timeline_entry_id uuid NOT NULL REFERENCES timeline_entries(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_path     text NOT NULL,
  display_path      text NOT NULL,
  media_type        text NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo', 'video')),
  source            text NOT NULL DEFAULT 'uploaded' CHECK (source IN ('uploaded', 'ai_generated')),
  caption           text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_timeline_entry_photos_entry ON timeline_entry_photos (timeline_entry_id, created_at);

ALTER TABLE timeline_entry_photos ENABLE ROW LEVEL SECURITY;

-- Read: any provisioned family member (the timeline is shared).
CREATE POLICY "Read for members" ON timeline_entry_photos FOR SELECT
  USING (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()));

-- Write/remove: your own rows (you can pin photos to anyone's event, but only
-- manage the ones you added).
CREATE POLICY "Insert own" ON timeline_entry_photos FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Delete own" ON timeline_entry_photos FOR DELETE
  USING (user_id = auth.uid());
