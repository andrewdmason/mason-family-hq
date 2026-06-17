import { createHash } from "node:crypto";

/**
 * Stable content hash of a page's query result, used to decide whether a
 * background "sync on load" actually changed what the page would render.
 *
 * The on-load sync upserts every event/assignment with `ON CONFLICT DO UPDATE`,
 * which fires the `update_updated_at_column` trigger on every row each run — so
 * row counts and `updated_at` always look "changed" even on an idempotent sync.
 * Hashing the exact rows the page queries instead lets the caller tell a real
 * change from a no-op, and skip the `router.refresh()` that would otherwise
 * flash the loading skeleton on every visit.
 *
 * Pass the same query result the page renders (already ordered) so the hash is
 * deterministic across runs. `ignoreKeys` drops named properties (at any depth)
 * before hashing — use it for sync-bookkeeping columns the page happens to
 * select but doesn't render, like `last_synced_at`/`updated_at`, which the
 * upsert bumps on every run and would otherwise mask a real "no change".
 */
export function fingerprint(rows: unknown, ignoreKeys: string[] = []): string {
  const drop = new Set(ignoreKeys);
  const json = drop.size
    ? JSON.stringify(rows, (key, value) => (drop.has(key) ? undefined : value))
    : JSON.stringify(rows);
  return createHash("sha1").update(json).digest("hex");
}
