# mason-family-hq

## Conventions for agents

- **Agents never bind port 3000** — it's reserved for the human's Conductor run-workspace flow.
  Use `npm run dev:agent` (boots the dev server on a free ephemeral port and prints the URL).
  For any other server, take a port from `PORT=$(node scripts/free-port.js)` and pass it via
  `-p`/`--port`/`PORT`. Enforced by `.claude/hooks/block-port-3000.js`. Never kill whatever is
  listening on 3000.

## Production access for agents (read-only)

- **MCP Supabase = PRODUCTION, READ-ONLY**: the `supabase-server` MCP runs with `--read-only`,
  so `execute_sql` can `SELECT` against prod to reproduce bugs but CANNOT write. There is no
  write path. Deliberate prod data fixes go through migrations/admin tooling, never the MCP.
- **MCP Vercel = DEPLOYMENTS/LOGS, READ-ONLY**: the `vercel` MCP reads deployment status, build
  logs, and runtime logs. Agents never mutate Vercel: deploys happen via git push (auto-deploy),
  env vars change in the dashboard. Mutating `vercel` CLI commands are blocked by
  `.claude/hooks/block-vercel-writes.js`; read forms (`vercel ls/logs/inspect/whoami`) are fine.
