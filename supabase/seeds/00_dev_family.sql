-- Local-dev only: the full family as confirmed auth users (Andrew the owner, plus
-- Jenny, Oscar, and Sebastian) so that `supabase db reset` can attribute the demo
-- journal entries (05_journal_entries, 06_family_journal) without anyone signing
-- in first, and so you can dev-login as any of them (/auth/dev-login?email=…).
--
-- Seeds run only on `supabase db reset` and in CI — never on a production deploy
-- (migrations are pushed without seeds) — so these manufactured users stay out of
-- prod. Each is a complete GoTrue user (users row + email identity) mirroring what
-- /auth/dev-login creates via the admin API; dev-login stays compatible because it
-- finds them by email and reuses them.
--
-- Per-member journals (question types, agent files, settings) are still provisioned
-- on first dev-login: we link family_members.user_id but leave seeded_at NULL,
-- the exact pre-sign-in state ensureProvisioned expects.
--
-- The uuids are hardcoded only because these are throwaway local fixtures (stable
-- across resets); production never runs this file.

DO $$
DECLARE
  m record;
  resolved uuid;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('andrew@mason.io',    'Andrew',    'owner',  'a0000000-0000-4000-8000-000000000001'::uuid),
      ('jenny@mason.io',     'Jenny',     'parent', 'a0000000-0000-4000-8000-000000000002'::uuid),
      ('oscar@mason.io',     'Oscar',     'kid',    'a0000000-0000-4000-8000-000000000003'::uuid),
      ('sebastian@mason.io', 'Sebastian', 'kid',    'a0000000-0000-4000-8000-000000000004'::uuid)
    ) AS v(email, name, role, uid)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = m.email) THEN
      -- GoTrue scans these token columns into non-nullable Go strings, so they must
      -- be '' (not NULL) or every auth query errors with "Database error checking
      -- email". The table leaves them nullable with no default, so set them here.
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', m.uid, 'authenticated', 'authenticated',
        m.email, crypt('devpassword', gen_salt('bf')),
        now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        now(), now(),
        '', '', '', ''
      );

      -- A matching email identity makes it a complete GoTrue user (magic-link login).
      INSERT INTO auth.identities (
        provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) VALUES (
        m.uid::text, m.uid,
        jsonb_build_object('sub', m.uid::text, 'email', m.email, 'email_verified', true),
        'email', now(), now(), now()
      );
    END IF;

    SELECT id INTO resolved FROM auth.users WHERE email = m.email;

    -- Upsert the membership row. The owner row already exists from migration 00051
    -- (renamed to family_members in 00086; NULL user_id on a fresh DB); the others
    -- are inserted. seeded_at is
    -- left untouched so each member's first dev-login still provisions their journal.
    INSERT INTO family_members (email, user_id, name, role)
    VALUES (m.email, resolved, m.name, m.role)
    ON CONFLICT (email) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          name = EXCLUDED.name,
          role = EXCLUDED.role;
  END LOOP;
END $$;
