// Agent API over MCP (Streamable HTTP), so an assistant that can't hold a
// secret itself can reach the calendar through a connector: the bearer secret
// lives in the connector's request headers, never in the conversation. Same
// auth as the rest of /api/agent/* (see @/lib/agent/auth).
//
// Stateless: every POST gets a fresh server + transport and a plain JSON
// response, which is what a serverless function can offer — no sessions and no
// server-initiated stream, hence 405 on GET and DELETE.

import { type NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { agentAuthorized, agentUnauthorized } from "@/lib/agent/auth";
import { buildCalendarMcpServer } from "./tools";

export const dynamic = "force-dynamic";
// sync_calendar runs the sync in-process, which can take most of a minute.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!agentAuthorized(req)) return agentUnauthorized();

  const server = buildCalendarMcpServer({
    origin: new URL(req.url).origin,
    authorization: req.headers.get("authorization") ?? "",
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

function methodNotAllowed(): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
