-- Drop-off / pick-up duty assignments with drive-time blocks.
--
-- For any kid-owned timed event, a parent can be assigned drop-off and/or
-- pick-up duty (or the duty marked explicitly not-needed). An assigned duty
-- materializes a REAL round-trip drive-time event on that parent's Google
-- calendar (mirrored locally), computed from home → event location via
-- Nominatim geocoding + Google Routes API. Ported in spirit from KidCalendar,
-- whose drive-time machinery was intentionally not carried over in 00098.

-- ---------------------------------------------------------------------------
-- 1. Duty assignments. Unset = no row; explicitly-not-needed = is_na row.
--    assignee_email is a real FK (no 'N/A' sentinel) so member renames cascade,
--    same as event_attendees (00111).
-- ---------------------------------------------------------------------------
CREATE TABLE event_duty_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  duty           text NOT NULL CHECK (duty IN ('dropoff', 'pickup')),
  assignee_email text
    REFERENCES family_members(email) ON UPDATE CASCADE ON DELETE CASCADE,
  is_na          boolean NOT NULL DEFAULT false,

  -- Drive-block ledger: where the materialized block lives, and a hash of what
  -- we last wrote so the cron sweep can detect drift (event moved, drive time
  -- recalculated, settings changed) and patch instead of rewriting every tick.
  drive_event_id        uuid REFERENCES calendar_events(id) ON DELETE SET NULL,
  drive_google_event_id text,
  drive_calendar_id     text,
  drive_sync_hash       text,
  drive_synced_at       timestamptz,
  drive_is_estimate     boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_event_duty UNIQUE (event_id, duty),
  CONSTRAINT chk_duty_state CHECK (NOT (is_na AND assignee_email IS NOT NULL))
);

CREATE INDEX idx_event_duty_event ON event_duty_assignments (event_id);

CREATE TRIGGER event_duty_assignments_updated_at
  BEFORE UPDATE ON event_duty_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE event_duty_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read for members" ON event_duty_assignments FOR SELECT
  USING (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()));
CREATE POLICY "Manage for parents" ON event_duty_assignments FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m
                 WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m
                      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')));

-- ---------------------------------------------------------------------------
-- 2. Drive cache + mirror-link columns on calendar_events.
--    Cache: geocoded coords + drive minutes per event (KidCalendar pattern);
--    geocoded_location records WHICH location text was geocoded, so a location
--    edit invalidates the cache by comparison, no trigger needed. The sync
--    upserts use fixed column lists, so these survive every re-sync.
--    Mirror link: set only on drive-block rows, pointing at the kid's source
--    event — the UI uses it to color the block with the kid's color and to
--    open the kid's event sheet on tap.
-- ---------------------------------------------------------------------------
ALTER TABLE calendar_events
  ADD COLUMN location_lat          double precision,
  ADD COLUMN location_lng          double precision,
  ADD COLUMN geocoded_at           timestamptz,
  ADD COLUMN geocoded_location     text,
  ADD COLUMN drive_minutes         integer,
  ADD COLUMN drive_calculated_at   timestamptz,
  ADD COLUMN drive_source_event_id uuid REFERENCES calendar_events(id) ON DELETE CASCADE,
  ADD COLUMN drive_duty            text CHECK (drive_duty IN ('dropoff', 'pickup'));

-- Race-safe mirror upsert: one block per (source event, duty), even if the
-- live action and the cron sweep reconcile concurrently. Non-partial (NULL
-- pairs never conflict) so PostgREST's ON CONFLICT inference can use it; it
-- also serves prefix lookups by drive_source_event_id.
CREATE UNIQUE INDEX uq_calendar_events_drive_mirror
  ON calendar_events (drive_source_event_id, drive_duty);

-- ---------------------------------------------------------------------------
-- 3. Logistics settings: single-row (id=1) like journal_family. Home lat/lng
--    are geocoded by the cron on first run (and re-geocoded when the address
--    is edited — home_geocoded_at < updated_at signals staleness).
-- ---------------------------------------------------------------------------
CREATE TABLE calendar_logistics_settings (
  id                   int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  home_address         text NOT NULL,
  home_lat             double precision,
  home_lng             double precision,
  home_geocoded_at     timestamptz,
  drive_buffer_minutes int NOT NULL DEFAULT 5,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER calendar_logistics_settings_updated_at
  BEFORE UPDATE ON calendar_logistics_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE calendar_logistics_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read for members" ON calendar_logistics_settings FOR SELECT
  USING (EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = auth.uid()));
CREATE POLICY "Manage for parents" ON calendar_logistics_settings FOR ALL
  USING (EXISTS (SELECT 1 FROM family_members m
                 WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')))
  WITH CHECK (EXISTS (SELECT 1 FROM family_members m
                      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'parent')));

INSERT INTO calendar_logistics_settings (id, home_address)
VALUES (1, '2909 Avalon Ave. Berkeley, CA 94705');
