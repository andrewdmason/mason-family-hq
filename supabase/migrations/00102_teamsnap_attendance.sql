-- Restore TeamSnap attendance/RSVP, which the calendar port (00098) left out:
-- it kept `teamsnap_rsvp` as a passive, read-only field and never wired up the
-- linkage needed to write an RSVP back to TeamSnap or to read the team roster.
--
-- Two things were missing:
--
--   * Which roster member a team source represents. A TeamSnap source belongs to
--     a kid (member_email), but to read "my" RSVP and write it back we need the
--     kid's TeamSnap *member* id on that team. The column existed
--     (teamsnap_player_member_id) but the add-team flow never populated it.
--
--   * Which connection's token can reach the team. Sync discovers this by walking
--     every connection each run; a single RSVP write shouldn't have to. We record
--     the connecting member's email when the source is added so write-back and
--     the team-availability read use the right token directly (falling back to
--     discovery when it's null, e.g. for sources added before this migration).

ALTER TABLE calendar_sources
  ADD COLUMN teamsnap_connection_email text
    REFERENCES family_members(email) ON DELETE SET NULL;
