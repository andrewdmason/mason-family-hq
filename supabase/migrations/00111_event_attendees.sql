-- The "going" feature: on any event, simple per-member toggles for who's going
-- (besides the owner). Binary going/not-going — deliberately NOT TeamSnap's
-- read-only RSVP (teamsnap_rsvp), which is a different axis (is the player
-- playing, vs. is a parent/sibling attending).
--
-- This table is the durable source of truth for "going". The importer rewrites
-- the real Google event on every sync; it reconstructs the event's native guest
-- list from these rows (and reconciles each member as a Google guest), so the
-- going state survives re-sync. We keep a row with going=false on toggle-off (vs.
-- deleting it) so reconciliation knows to REMOVE the guest, not just "never add".
--
-- member_email gets ON UPDATE CASCADE explicitly: 00104 retro-fitted that onto
-- every pre-existing FK to family_members, but this table is created afterward,
-- so renaming a member (e.g. onto an @mason.io address) must cascade here too.

CREATE TABLE event_attendees (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  member_email text NOT NULL
    REFERENCES family_members(email) ON UPDATE CASCADE ON DELETE CASCADE,
  going        boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_event_attendee UNIQUE (event_id, member_email)
);

CREATE INDEX idx_event_attendees_event ON event_attendees (event_id);

CREATE TRIGGER event_attendees_updated_at
  BEFORE UPDATE ON event_attendees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS mirrors calendar_events: any provisioned member can read; only owner/parent
-- can manage. The importer's guest reconciliation writes through the service role
-- and bypasses these.
ALTER TABLE event_attendees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read for members" ON event_attendees FOR SELECT
  USING (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()));
CREATE POLICY "Manage for parents" ON event_attendees FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m
                 WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m
                      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')));
