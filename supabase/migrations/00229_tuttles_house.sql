-- The house in the Tuttles app: what each kid builds with the coins and gems
-- Vocab and Math pay (ios/Tuttles/iPhone/House, src/lib/tuttles/house.ts).
-- The purse and the house are the phone's to make sense of, as Math's state
-- is: only the newest is kept here, so another phone can pick it up and so
-- the other house on the street can be shown.
--
-- Written by the website with the service role (/tuttles/api/house/sync). A
-- person reads their own and the parents read everyone's, as with Words.

CREATE TABLE IF NOT EXISTS tuttles_house_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  rev integer NOT NULL CHECK (rev >= 0),
  json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tuttles_house_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tuttles house state: own or parent" ON tuttles_house_state;
CREATE POLICY "Tuttles house state: own or parent" ON tuttles_house_state FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM family_members WHERE user_id = auth.uid() AND role IN ('owner', 'parent'))
);
