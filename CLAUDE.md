# mason-family-hq

## Conventions for agents

- **Agents never bind port 3000** — it's reserved for the human's Conductor run-workspace flow.
  Use `npm run dev:agent` (boots the dev server on a free ephemeral port and prints the URL).
  For any other server, take a port from `PORT=$(node scripts/free-port.js)` and pass it via
  `-p`/`--port`/`PORT`. Enforced by `.claude/hooks/block-port-3000.js`. Never kill whatever is
  listening on 3000.
