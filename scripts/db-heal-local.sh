#!/usr/bin/env bash
# Self-heal the SHARED local supabase database before `next dev` starts.
#
# Every Conductor workspace of this repo talks to the same local supabase
# instance. When a sibling workspace runs `supabase db reset`, it re-applies
# only ITS branch's migrations — this branch's tables/columns vanish and the
# app's queries go silently empty ("Nothing scheduled this day"). The supabase
# CLI then refuses `migration up` because the history holds versions that
# don't exist in this worktree.
#
# This script sidesteps the CLI: any migration file in supabase/migrations/
# whose version is missing from supabase_migrations.schema_migrations is
# applied directly with psql (single transaction each), recorded in the
# history table, and PostgREST's schema cache is reloaded. Additive sibling
# migrations coexist; each workspace heals itself on boot.
#
# Fail-open by design: if the local stack isn't running (or psql is missing),
# exit quietly — e.g. when pointing at production supabase.

set -uo pipefail

DB_URL="postgresql://postgres:postgres@127.0.0.1:54522/postgres"

command -v psql >/dev/null 2>&1 || exit 0

applied=$(psql "$DB_URL" -t -A \
  -c "SELECT version FROM supabase_migrations.schema_migrations" 2>/dev/null) || exit 0

healed=0
for f in supabase/migrations/*.sql; do
  [ -e "$f" ] || continue
  base=$(basename "$f" .sql)
  version=${base%%_*}
  name=${base#*_}
  if ! grep -qx "$version" <<<"$applied"; then
    echo "[db-heal] applying missing migration $base"
    if psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$f"; then
      psql "$DB_URL" -q -c "INSERT INTO supabase_migrations.schema_migrations (version, name)
                            VALUES ('$version', '$name') ON CONFLICT DO NOTHING"
      healed=1
    else
      echo "[db-heal] FAILED to apply $base — fix manually" >&2
    fi
  fi
done

if [ "$healed" = 1 ]; then
  # PostgREST caches the schema; without this, new columns read as 42703.
  psql "$DB_URL" -q -c "NOTIFY pgrst, 'reload schema'"
  echo "[db-heal] done — PostgREST schema cache reloaded"
fi

exit 0
