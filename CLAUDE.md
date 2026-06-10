# CLAUDE.md

## Production access for agents (read-only)

- **MCP Supabase = PRODUCTION, READ-ONLY**: the `supabase-server` MCP runs with `--read-only`,
  so `execute_sql` can `SELECT` against prod to reproduce bugs but CANNOT write. There is no
  write path. Deliberate prod data fixes go through migrations/admin tooling, never the MCP.
- **MCP Vercel = DEPLOYMENTS/LOGS, READ-ONLY**: the `vercel` MCP reads deployment status, build
  logs, and runtime logs. Agents never mutate Vercel: deploys happen via git push (auto-deploy),
  env vars change in the dashboard. Mutating `vercel` CLI commands are blocked by
  `.claude/hooks/block-vercel-writes.js`; read forms (`vercel ls/logs/inspect/whoami`) are fine.
