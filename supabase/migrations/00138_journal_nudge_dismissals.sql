-- The Todos Today view shows a synthetic "Write in your journal" row until the
-- user has journaled that day. Checking it off doesn't complete a real task —
-- it just records "leave me alone for today" here. One row per user per local
-- date; the row (and any dismissal) resets naturally when the date rolls over.

CREATE TABLE journal_nudge_dismissals (
  user_id      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  dismissed_on date NOT NULL,  -- the user's local date (same as journal_entries.entry_date)
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dismissed_on)
);

ALTER TABLE journal_nudge_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own dismissals" ON journal_nudge_dismissals FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
