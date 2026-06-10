#!/usr/bin/env node
/**
 * PreToolUse(Bash) guard: agents never bind port 3000.
 *
 * Port 3000 belongs to the HUMAN: Conductor's "run workspace" flow boots the current
 * workspace on localhost:3000. Agents are hard-blocked from binding it and pointed at
 * ephemeral ports. Only runs inside Claude Code (agent tool calls).
 *
 * Contract: read PreToolUse JSON on stdin, inspect tool_input.command. Exit 0 to allow,
 * exit 2 to BLOCK (stderr is shown to the model). Fail-open on anything unexpected.
 */

function readStdin() {
  try {
    return require('fs').readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function getCommand(raw) {
  try {
    const data = JSON.parse(raw);
    if (data.tool_name && data.tool_name !== 'Bash') return null;
    return (data.tool_input && data.tool_input.command) || null;
  } catch {
    return null;
  }
}

// A segment explicitly asks for a port via flag (-p/--port, any value) …
const HAS_PORT_FLAG = /(?:^|\s)(?:-p|--port)(?:[= ]|$)/;
// … or via a PORT= env assignment with a non-3000 value.
const HAS_SAFE_PORT_ENV = /(?:^|\s)PORT=(?!["']?3000(?!\d))\S+/;
// Explicit 3000, either style.
const EXPLICIT_3000 = /(?:^|\s)(?:(?:-p|--port)[= ]|PORT=)["']?3000(?!\d)/;
// Commands that boot a server on 3000 by default (Next.js).
const NEXT_SERVER = /^(?:npx\s+)?next\s+(?:dev|start)\b/;
const PKG_RUN_SERVER = /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start)(?![\w:.-])/;

// Strip leading env assignments (FOO=bar) and benign wrappers so the regexes above test the
// actual command word.
function commandPosition(seg) {
  let s = seg;
  for (;;) {
    const next = s.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+|(?:nohup|time|exec|env)\s+)/, '');
    if (next === s) return s;
    s = next;
  }
}

/** Returns a reason string if blocked, else null. Segments evaluated independently. */
function blockReason(cmd) {
  const full = cmd.replace(/\s+/g, ' ').trim();
  for (const rawSeg of full.split(/&&|\|\||[;\n|&]/).map((s) => s.trim()).filter(Boolean)) {
    const seg = commandPosition(rawSeg);
    const isServer = NEXT_SERVER.test(seg) || PKG_RUN_SERVER.test(seg);
    // `PORT=3000 <anything>` as a real env prefix → block regardless of the command.
    if (/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*PORT=["']?3000(?!\d)/.test(rawSeg)) {
      return 'this command sets PORT=3000.';
    }
    if (isServer && EXPLICIT_3000.test(rawSeg)) {
      return 'this command explicitly targets port 3000.';
    }
    if (isServer && !HAS_PORT_FLAG.test(rawSeg) && !HAS_SAFE_PORT_ENV.test(rawSeg)) {
      return 'this dev/start server would bind its default port 3000.';
    }
  }
  return null;
}

const cmd = getCommand(readStdin());
if (!cmd) process.exit(0);

const reason = blockReason(cmd);
if (!reason) process.exit(0);

process.stderr.write(
  [
    `🛑 BLOCKED: ${reason}`,
    '',
    'Port 3000 is reserved for the human: Conductor "run workspace" always boots on',
    'localhost:3000 and breaks if an agent test server is squatting there. Agents test on an',
    'ephemeral port instead:',
    '  • dev server:    npm run dev:agent                             (free port, prints the URL)',
    '  • anything else: PORT=$(node scripts/free-port.js) then pass it via -p/--port/PORT',
    '',
    "Do NOT work around this by killing whatever is on 3000 — that is the human's server.",
    '(This guard only runs inside Claude Code; humans in a plain terminal are unaffected.)',
  ].join('\n') + '\n'
);
process.exit(2);
