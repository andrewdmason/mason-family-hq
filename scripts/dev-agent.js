#!/usr/bin/env node
/**
 * dev-agent: start the dev server on a free EPHEMERAL port (never 3000).
 *
 * Port 3000 belongs to the human's Conductor run-workspace flow. Agents use this instead of
 * `npm run dev` (a PreToolUse hook enforces it; see .claude/hooks/block-port-3000.js).
 *
 * Usage:
 *   npm run dev:agent                 # picks a free port, prints the URL
 *   PORT=4123 npm run dev:agent       # use a specific (non-3000) port instead
 */
const { spawn } = require('child_process');
const { getFreePort } = require('./free-port');

async function main() {
  let port;
  if (process.env.PORT) {
    port = Number(process.env.PORT);
    if (!Number.isInteger(port) || port === 3000) {
      console.error(`dev-agent: PORT=${process.env.PORT} is not allowed (must be a number, never 3000).`);
      process.exit(1);
    }
  } else {
    port = await getFreePort();
  }

  console.log(`▶ agent dev server: http://localhost:${port}  (port 3000 stays free for the human)`);

  // Delegate to the canonical dev script (Next.js) so flags/config stay in one place.
  // `-p <port>` is the Next.js form; it's forwarded to `next dev` via the `--` separator.
  const child = spawn('npm', ['run', 'dev', '--', '-p', String(port)], { stdio: 'inherit' });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => child.kill(sig));
  }
}

main().catch((err) => {
  console.error(`dev-agent failed: ${err.message}`);
  process.exit(1);
});
