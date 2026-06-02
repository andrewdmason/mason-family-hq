-- Family member profiles: birthdate + parent links.
--
-- Lets the app address a recommender by relationship ("Dad"/"Mom") rather than
-- name. Parents are stored by EMAIL (journal_members' primary key), not auth
-- user_id, so the links can be set before a member has ever signed in (their
-- user_id doesn't exist until first sign-in) and survive email edits via the
-- cascade. There is exactly one family, so these are safe to bootstrap here.

ALTER TABLE journal_members ADD COLUMN birthdate date;
ALTER TABLE journal_members ADD COLUMN mother_email text
  REFERENCES journal_members(email) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE journal_members ADD COLUMN father_email text
  REFERENCES journal_members(email) ON UPDATE CASCADE ON DELETE SET NULL;

-- One-time family bootstrap (mirrors the owner seed in 00051) so a fresh deploy
-- has the whole family with profiles. Idempotent: existing rows keep their
-- name/user_id; only the new profile columns are (re)set below.
INSERT INTO journal_members (email, name, is_owner) VALUES
  ('jenny@mason.io',     'Jenny',     false),
  ('oscar@mason.io',     'Oscar',     false),
  ('sebastian@mason.io', 'Sebastian', false)
ON CONFLICT (email) DO NOTHING;

UPDATE journal_members SET birthdate = '1980-10-22' WHERE email = 'andrew@mason.io';
UPDATE journal_members SET birthdate = '1980-08-10' WHERE email = 'jenny@mason.io';
UPDATE journal_members SET birthdate = '2016-07-14' WHERE email = 'oscar@mason.io';
UPDATE journal_members SET birthdate = '2013-12-19' WHERE email = 'sebastian@mason.io';

-- Oscar and Sebastian's parents are Jenny (mother) and Andrew (father).
UPDATE journal_members
  SET mother_email = 'jenny@mason.io', father_email = 'andrew@mason.io'
  WHERE email IN ('oscar@mason.io', 'sebastian@mason.io');
