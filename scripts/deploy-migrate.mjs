#!/usr/bin/env node
/**
 * Apply pending Supabase migrations as the first step of a PRODUCTION Vercel build,
 * so the app can never ship ahead of the schema it needs.
 *
 * Why this lives in the build and not in CI: the migration workflow and Vercel used to
 * run as independent reactions to the same push, with no ordering between them. On
 * 2026-08-07 the migration failed (a bad Supabase CLI release) and the app deployed
 * anyway — the deployed code selected a column that didn't exist, and because a failed
 * PostgREST select reads as "no row", the reader's quiz pages answered "not found"
 * rather than erroring. A red check in one system can't stop a deploy in the other.
 *
 * A failing build is the one lever that does stop it. So: migrate, then build. If the
 * migration fails the build dies here, nothing new is published, and the previous
 * deployment keeps serving the schema it was written against.
 *
 * Skew is now one-directional. The schema can be ahead of the code (a migration
 * applied, then `next build` failed) — that's the safe direction, since an unused
 * column harms nothing. The code can no longer be ahead of the schema.
 *
 * Runs ONLY on Vercel production builds: preview deployments and local `npm run build`
 * skip it entirely, so nothing here can touch production from a branch or a laptop.
 */

import { spawnSync } from "node:child_process";

// Pinned deliberately. An unpinned CLI is what broke migrations on 2026-08-07 with no
// change on our side — see .github/workflows/migrate.yml. Bump both together.
const SUPABASE_CLI = "supabase@2.111.0";

const log = (msg) => console.log(`[deploy-migrate] ${msg}`);

/** Vercel sets VERCEL_ENV to production | preview | development. */
if (process.env.VERCEL_ENV !== "production") {
  log(`VERCEL_ENV=${process.env.VERCEL_ENV ?? "(unset)"} — not a production build, skipping migrations.`);
  process.exit(0);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.env.SUPABASE_PROJECT_REF;

// Fail loudly rather than skipping. A silent skip on missing credentials would
// reintroduce the exact failure this script exists to prevent: a production deploy
// that never checked whether its schema was applied.
if (!token || !projectRef) {
  const missing = [
    !token && "SUPABASE_ACCESS_TOKEN",
    !projectRef && "SUPABASE_PROJECT_REF",
  ].filter(Boolean);
  console.error(
    `[deploy-migrate] Missing required production env: ${missing.join(", ")}.\n` +
      `[deploy-migrate] Add them to the Vercel project's Production environment. ` +
      `Refusing to build: an unmigrated deploy is how the app ends up serving a schema that isn't there.`
  );
  process.exit(1);
}

/** Run a CLI step, streaming output into the build log; return false on any failure. */
function run(label, args) {
  log(`${label}…`);
  const result = spawnSync("npx", ["--yes", SUPABASE_CLI, ...args], {
    stdio: "inherit",
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
  });
  if (result.error) {
    console.error(`[deploy-migrate] ${label} could not start: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    console.error(`[deploy-migrate] ${label} failed (exit ${result.status}).`);
    return false;
  }
  return true;
}

// `link` writes the target project ref locally; `db push` applies everything pending.
// --include-all so a migration numbered below an already-applied one still goes out
// (branches merge out of order here).
const ok =
  run("Linking Supabase project", ["link", "--project-ref", projectRef]) &&
  run("Pushing pending migrations", ["db", "push", "--include-all"]);

if (!ok) {
  console.error(
    `[deploy-migrate] Migrations did not apply — failing the build on purpose so this ` +
      `commit is not published. The previous deployment keeps serving; fix the migration ` +
      `(or the CLI pin) and redeploy.`
  );
  process.exit(1);
}

log("Schema is current — continuing to next build.");
