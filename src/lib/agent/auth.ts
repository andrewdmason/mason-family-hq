// Bearer auth for the agent-facing API (/api/agent/*). The family assistant
// (an external agent with no browser session) authenticates with a shared
// secret, following the cron-sync pattern. Without a configured secret the
// routes refuse to run, so they can't be hit anonymously.

export function agentAuthorized(req: Request): boolean {
  const expected = process.env.AGENT_API_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  return token.length > 0 && token === expected;
}

export function agentUnauthorized(): Response {
  return Response.json(
    {
      error: process.env.AGENT_API_SECRET
        ? "Unauthorized — send Authorization: Bearer <AGENT_API_SECRET>."
        : "Agent API disabled — AGENT_API_SECRET is not configured.",
    },
    { status: 401 },
  );
}
