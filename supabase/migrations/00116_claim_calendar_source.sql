-- Atomic materialize lease as an RPC, replacing a client-side conditional UPDATE.
--
-- claimSource() in materialize.ts originally did the claim with supabase-js as:
--   .update({ materialize_claimed_at: now })
--   .or('materialize_claimed_at.is.null,materialize_claimed_at.lt.<stale>')
-- but PostgREST (v14) rejects an `or=()` filter on a mutation with
-- "column ... does not exist" (42703) — it fails for ANY column, not just new
-- ones. The claim therefore always errored and returned false, so the importer
-- never materialized anything. Doing the conditional update inside a SECURITY
-- DEFINER function sidesteps PostgREST's filter parsing entirely and keeps the
-- check-and-set atomic (a single UPDATE … WHERE), which is the whole point of the
-- lease: only one concurrent sync run materializes a given source.

CREATE OR REPLACE FUNCTION claim_calendar_source(
  p_source_id uuid,
  p_lease_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE calendar_sources
     SET materialize_claimed_at = now()
   WHERE id = p_source_id
     AND (
       materialize_claimed_at IS NULL
       OR materialize_claimed_at < now() - make_interval(secs => p_lease_seconds)
     )
  RETURNING true;
$$;

-- The importer only ever calls this with the service-role client, but grant to
-- authenticated too so the function is usable if a future caller needs it.
GRANT EXECUTE ON FUNCTION claim_calendar_source(uuid, integer) TO service_role, authenticated;
