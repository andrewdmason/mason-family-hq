#!/usr/bin/env node
/**
 * PreToolUse(Bash) guard: block mutating `vercel` CLI commands from agent sessions.
 *
 * The Vercel CLI on this machine is authenticated with FULL account power: a bare `vercel`
 * deploys, `vercel env pull` writes prod secrets to disk, `vercel rm` deletes deployments.
 * Agents never do any of that:
 *   • Deploys happen exclusively via git push — Vercel auto-deploys from GitHub.
 *   • Env-var changes happen in the Vercel dashboard (humans only).
 *   • READS (deployment status, build/runtime logs) go through the read-only `vercel` MCP.
 *
 * ALLOWLIST-based for `vercel` segments, because the CLI's *default* action — bare `vercel`
 * with no subcommand — is "deploy". Non-vercel commands are untouched.
 *
 * Contract: read the PreToolUse JSON on stdin, inspect tool_input.command. Exit 0 to allow,
 * exit 2 to BLOCK (stderr is shown to the model). Parsing failures → allow (the guard's
 * scope is "vercel CLI segments", not "everything we can't parse").
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

// Subcommands that only read. Anything else (including NO subcommand = implicit deploy,
// and anything new/unknown) is blocked for agents.
const READ_SUBCOMMANDS = new Set(['ls', 'list', 'logs', 'inspect', 'whoami', 'help']);

// Resource groups whose `ls`/`list`/`inspect` forms are reads (e.g. `vercel env ls`,
// `vercel project ls`). Their other forms (`env pull`, `project rm`, …) stay blocked.
const GROUPS_WITH_READ_VERBS = new Set([
  'env', 'project', 'projects', 'teams', 'team', 'domains', 'alias', 'dns', 'certs',
]);
const GROUP_READ_VERBS = new Set(['ls', 'list', 'inspect']);

/**
 * Returns a reason string if the segment is a blocked vercel invocation, else null.
 * Each shell segment is evaluated independently (split on && || ; | & and newlines) so a
 * safe read in one segment can't smuggle a deploy in the next.
 */
function blockReason(cmd, depth = 0) {
  // Recursion guard for nested `npx -c '…'` strings. FAIL CLOSED: a command nested too
  // deep to analyze is blocked, not waved through — >3 runner layers is never legitimate.
  if (depth > 3) return 'runner `-c` nesting too deep to analyze (fail-closed).';
  let full = cmd.replace(/\s+/g, ' ').trim();

  // Command substitutions RUN their contents — `RESULT=$(vercel deploy)` deploys, and the
  // env-var stripper below would otherwise eat the `RESULT=$(vercel` token whole. Evaluate
  // each substitution's contents as a command in its own right, then collapse it to an inert
  // placeholder so outer tokenization isn't confused. The innermost-first loop ($()
  // contents matched only when paren-free) peels nested substitutions one layer per pass.
  const SUBST_RE = /\$\(([^()]*)\)|`([^`]*)`/;
  for (let m; (m = full.match(SUBST_RE)); ) {
    const inner = m[1] !== undefined ? m[1] : m[2];
    const reason = blockReason(inner, depth); // same depth: the loop itself terminates
    if (reason) return reason;
    full = full.replace(m[0], '__SUBST__');
  }

  for (const seg of full.split(/&&|\|\||[;\n|&]/).map((s) => s.trim()).filter(Boolean)) {
    const reason = segmentReason(seg, depth);
    if (reason) return reason;
  }
  return null;
}

// Runner flags that consume the NEXT token as their value (npm exec/npx docs). Everything
// else (-y, --yes, --quiet, --package=vercel, …) is a single token and is dropped whole.
const RUNNER_FLAGS_WITH_VALUE = /^(-p|--package|-w|--workspace|--registry|--loglevel)$/;

function segmentReason(seg, depth = 0) {
  let tokens = seg.split(/\s+/);

  // Strip leading env-var assignments (FOO=bar vercel …).
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens = tokens.slice(1);

  // Unwrap package runners so the real command word surfaces despite runner flags:
  // `npx …`, `npm exec …`, `bunx …`, `pnpm dlx …`, `yarn dlx …`.
  let isRunner = false;
  if (tokens[0] === 'npx' || tokens[0] === 'bunx') {
    tokens = tokens.slice(1);
    isRunner = true;
  } else if (
    (tokens[0] === 'npm' && tokens[1] === 'exec') ||
    ((tokens[0] === 'pnpm' || tokens[0] === 'yarn') && tokens[1] === 'dlx')
  ) {
    tokens = tokens.slice(2);
    isRunner = true;
  }
  if (isRunner) {
    while (tokens.length && tokens[0].startsWith('-')) {
      const flag = tokens[0];
      if (flag === '--') {
        tokens = tokens.slice(1);
        break;
      }
      if (flag === '-c' || flag === '--call') {
        // `npx --package=vercel -c '<shell string>'` runs the string in a shell with the
        // package's bins on PATH — evaluate its (quote-stripped) contents as nested segments.
        const nested = tokens.slice(1).join(' ').replace(/^['"]|['"]$/g, '');
        return blockReason(nested, depth + 1);
      }
      tokens = tokens.slice(RUNNER_FLAGS_WITH_VALUE.test(flag) ? 2 : 1);
    }
  }
  if (!tokens.length) return null;

  // Only act on segments whose command is the vercel CLI: `vercel`, versioned `vercel@<ver>`
  // (npx form), or `vc` — the second bin the vercel package installs.
  const cmdWord = tokens[0].replace(/^.*\//, ''); // tolerate full paths like /usr/local/bin/vercel
  if (!/^(vercel|vc)(@[\w.^~-]+)?$/.test(cmdWord)) return null;

  // First two non-flag tokens after `vercel` = subcommand (+ verb).
  const args = tokens.slice(1).filter((t) => !t.startsWith('-'));
  const sub = (args[0] || '').toLowerCase();
  const verb = (args[1] || '').toLowerCase();

  // Bare `vercel` (possibly with flags/paths only): allow pure version/help queries…
  if (!sub) {
    const flagsOnly = tokens.slice(1).every((t) => /^(--version|-v|--help|-h)$/.test(t));
    if (tokens.length > 1 && flagsOnly) return null;
    return 'bare `vercel` is an implicit production/preview DEPLOY.';
  }

  if (READ_SUBCOMMANDS.has(sub)) return null;
  if (GROUPS_WITH_READ_VERBS.has(sub) && GROUP_READ_VERBS.has(verb)) return null;
  if (sub === 'telemetry' && verb === 'status') return null;

  return `\`vercel ${sub}\` can mutate the Vercel account (deploys, env vars, deletions).`;
}

const raw = readStdin();
const cmd = getCommand(raw);
if (!cmd) process.exit(0); // not a Bash command we can inspect → allow

const reason = blockReason(cmd);
if (!reason) process.exit(0); // allowed

process.stderr.write(
  [
    `🛑 BLOCKED: ${reason}`,
    '',
    'Agents never mutate Vercel. Instead:',
    '  • Deploys: push the branch / merge the PR — Vercel auto-deploys from GitHub.',
    '  • Deployment status, build logs, runtime logs (READ): use the `vercel` MCP tools',
    '    (ToolSearch "vercel"), or the read-only CLI forms: vercel ls / logs / inspect / whoami.',
    '  • Env vars: NEVER pull prod secrets locally. Changes happen in the Vercel dashboard,',
    '    by a human.',
    '',
    '(This guard only runs inside Claude Code; a human in a plain terminal is unaffected.)',
  ].join('\n') + '\n'
);
process.exit(2);
