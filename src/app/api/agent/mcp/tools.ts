// MCP tool definitions for the agent calendar API. Each tool is a thin adapter
// over the matching HTTP route handler in ../calendar/* — it builds a request,
// calls the handler in-process, and returns the handler's JSON as the tool
// result. Validation, error messages, Google writes and drive-block
// reconciliation therefore stay in one place and behave identically whether
// the assistant comes in over plain HTTP or over MCP.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { NextRequest } from "next/server";
import { z } from "zod";
import { FAMILY_TZ } from "@/lib/calendar/drive-time";
import { CAREGIVERS } from "@/lib/calendar/caregivers";
import { GET as getContext } from "@/app/api/agent/calendar/context/route";
import {
  GET as listEvents,
  POST as createEvent,
} from "@/app/api/agent/calendar/events/route";
import {
  GET as getEvent,
  PATCH as updateEvent,
  DELETE as deleteEvent,
} from "@/app/api/agent/calendar/events/[id]/route";
import { POST as setAttendance } from "@/app/api/agent/calendar/events/[id]/attendance/route";
import { POST as setGoing } from "@/app/api/agent/calendar/events/[id]/going/route";
import { POST as setDuty } from "@/app/api/agent/calendar/events/[id]/duty/route";
import { POST as setRsvp } from "@/app/api/agent/calendar/events/[id]/rsvp/route";
import { GET as getAvailability } from "@/app/api/agent/calendar/events/[id]/availability/route";
import { GET as getReview } from "@/app/api/agent/calendar/review/route";
import { POST as syncCalendar } from "@/app/api/agent/calendar/sync/route";

type RouteHandler = (
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

interface CallOptions {
  id?: string;
  query?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
}

const INSTRUCTIONS = `Family HQ is this family's calendar hub. It aggregates the kids' TeamSnap teams, school calendar feeds and everyone's Google calendars, and it owns family state Google Calendar doesn't have: whether a kid is going to an event, which parent is attending, who does drop-off and pick-up, and the kids' TeamSnap RSVPs.

Use these tools for ALL family scheduling, instead of a Google Calendar connector. Events created here land on the right person's real Google calendar automatically; writing family events to Google directly creates duplicates the app can't reconcile, and reading Google directly misses the attendance and driving state.

Never edit or delete drive blocks (events whose drive_block is set). They are generated from the drop-off/pick-up assignments: change the assignment with set_duty and the block follows.

Times: the family's timezone is ${FAMILY_TZ}. Send datetimes as ISO 8601 with an explicit UTC offset for that timezone. Responses are in UTC, so convert before telling anyone a time.

Call get_family_context once per conversation to map names to emails. Parents are the members with role "owner" or "parent".`;

const eventId = z.string().describe("The event's id, from list_events or get_review.");

export function buildCalendarMcpServer(opts: {
  origin: string;
  authorization: string;
}): McpServer {
  const server = new McpServer(
    { name: "family-hq-calendar", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );

  // Runs a calendar route handler in-process. The handlers re-check the bearer
  // secret themselves, so the caller's Authorization header is passed through.
  async function call(
    handler: RouteHandler,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    { id = "", query = {}, body }: CallOptions = {},
  ): Promise<CallToolResult> {
    const url = new URL(`/api/agent/calendar${path}`, opts.origin);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const req = new NextRequest(url, {
      method,
      headers: {
        authorization: opts.authorization,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    try {
      const res = await handler(req, { params: Promise.resolve({ id }) });
      return {
        content: [{ type: "text", text: await res.text() }],
        isError: !res.ok,
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: err instanceof Error ? err.message : "Request failed.",
          },
        ],
        isError: true,
      };
    }
  }

  // ── Reading ────────────────────────────────────────────────────────────

  server.registerTool(
    "get_family_context",
    {
      title: "Get family context",
      description:
        "Family members (name, email, role: owner/parent/kid), the calendar sources, and logistics settings (home address, drive buffer). Call once per conversation to map names to emails.",
      annotations: { readOnlyHint: true },
    },
    () => call(getContext as RouteHandler, "GET", "/context"),
  );

  server.registerTool(
    "list_events",
    {
      title: "List family events",
      description:
        "The family's events in a time range, for everyone or one member. Each event includes whose it is, who is marked going, drop-off/pick-up duties, the kid's TeamSnap RSVP, whether the kid is going (kid_going), and the ids of events it conflicts with. Defaults to now through the next 14 days. Use this, not Google Calendar, to answer what the family's day or week looks like, and include who is driving and who is going.",
      inputSchema: {
        from: z
          .string()
          .optional()
          .describe(
            "Start of the range: ISO 8601 datetime with UTC offset. A bare YYYY-MM-DD is read as a UTC day, which cuts off local evenings, so prefer a full datetime.",
          ),
        to: z
          .string()
          .optional()
          .describe("End of the range, same format as from."),
        member: z
          .string()
          .optional()
          .describe("Only this family member's events (their email)."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ from, to, member }) =>
      call(listEvents as RouteHandler, "GET", "/events", {
        query: { from, to, member },
      }),
  );

  server.registerTool(
    "get_event",
    {
      title: "Get one event",
      description:
        "One event by id, with its attendance, duties and conflicts.",
      inputSchema: { id: eventId },
      annotations: { readOnlyHint: true },
    },
    ({ id }) => call(getEvent, "GET", `/events/${id}`, { id }),
  );

  server.registerTool(
    "get_review",
    {
      title: "What needs attention",
      description:
        "The open scheduling problems for the coming days: conflicts (overlapping events for one person), missing_duties (kid events away from home with drop-off or pick-up undecided), unanswered_teamsnap (kid's RSVP still no-reply), and no_parent_going (kid events no parent is marked as attending). Good for a morning brief: propose a fix for each item and apply it once the parent agrees.",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe("How many days ahead to look. Default 14."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ days }) =>
      call(getReview as RouteHandler, "GET", "/review", { query: { days } }),
  );

  server.registerTool(
    "get_team_availability",
    {
      title: "Team RSVP roster",
      description:
        "The whole team's TeamSnap RSVP roster and counts for a team event (live read from TeamSnap).",
      inputSchema: { id: eventId },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ id }) =>
      call(getAvailability, "GET", `/events/${id}/availability`, { id }),
  );

  server.registerTool(
    "sync_calendar",
    {
      title: "Sync calendar sources",
      description:
        "Pull fresh data from TeamSnap, school feeds and Google before reading, when freshness matters (for example before a morning brief). The default is a quick pass; full also refreshes every TeamSnap RSVP and is slow.",
      inputSchema: {
        full: z
          .boolean()
          .optional()
          .describe("Run the slow, everything pass. Default false."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ full }) =>
      call(syncCalendar as RouteHandler, "POST", "/sync", {
        body: { full: full === true },
      }),
  );

  // ── Events ─────────────────────────────────────────────────────────────

  server.registerTool(
    "create_event",
    {
      title: "Create a family event",
      description:
        "Create an event for a family member. It lands on that person's real Google calendar when they have one connected (wrote_to_google in the result says whether it did), so do not also create it in Google Calendar.",
      inputSchema: {
        title: z.string(),
        member_email: z
          .string()
          .describe("Whose event it is: a family member's email."),
        start_time: z
          .string()
          .describe("ISO 8601 datetime with UTC offset."),
        end_time: z
          .string()
          .optional()
          .describe("ISO 8601 datetime with UTC offset."),
        all_day: z.boolean().optional(),
        location: z.string().optional(),
        description: z.string().optional(),
        calendar: z
          .string()
          .optional()
          .describe(
            '"auto" (default: the member\'s primary Google calendar), "app" (Family HQ only, not on Google), or a calendar source id from get_family_context.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    (args) =>
      call(createEvent as RouteHandler, "POST", "/events", { body: args }),
  );

  server.registerTool(
    "update_event",
    {
      title: "Edit an event",
      description:
        "Change an event's title, time, location or description. Only the fields you pass change. TeamSnap and school-feed events are synced from their source and can't be edited here (the result explains what to do instead). Never edit drive blocks.",
      inputSchema: {
        id: eventId,
        title: z.string().optional(),
        start_time: z
          .string()
          .optional()
          .describe("ISO 8601 datetime with UTC offset."),
        end_time: z
          .string()
          .nullable()
          .optional()
          .describe("ISO 8601 datetime with UTC offset; null clears it."),
        all_day: z.boolean().optional(),
        location: z.string().nullable().optional().describe("null clears it."),
        description: z
          .string()
          .nullable()
          .optional()
          .describe("null clears it."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ id, ...fields }) =>
      call(updateEvent, "PATCH", `/events/${id}`, { id, body: fields }),
  );

  server.registerTool(
    "delete_event",
    {
      title: "Delete an event",
      description:
        "Delete an event, including from the Google calendar it lives on. TeamSnap and school-feed events can't be deleted (they would come back on the next sync): if a kid is skipping one, use set_kid_attendance instead. Never delete drive blocks.",
      inputSchema: { id: eventId },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    ({ id }) => call(deleteEvent, "DELETE", `/events/${id}`, { id }),
  );

  // ── Attendance and driving ─────────────────────────────────────────────

  server.registerTool(
    "set_kid_attendance",
    {
      title: "Kid going / not going",
      description:
        "Mark whether a kid is going to one of their own events. Not going takes the event off every Google calendar (including a parent's who was going along) and removes its drop-off/pick-up drive blocks; going restores all of it with the assignments intact. Nothing is sent to TeamSnap, so the coach is not told: use set_teamsnap_rsvp for that. One event per call.",
      inputSchema: {
        id: eventId,
        going: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ id, going }) =>
      call(setAttendance, "POST", `/events/${id}/attendance`, {
        id,
        body: { going },
      }),
  );

  server.registerTool(
    "set_parent_going",
    {
      title: "Parent attending",
      description:
        "Mark a family member (usually a parent) as attending, or not attending, an event such as a kid's game. A parent who is going and also has the drive duty gets a one-way drive block instead of a round trip.",
      inputSchema: {
        id: eventId,
        member_email: z.string().describe("The attendee's email."),
        going: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ id, member_email, going }) =>
      call(setGoing, "POST", `/events/${id}/going`, {
        id,
        body: { member_email, going },
      }),
  );

  server.registerTool(
    "set_duty",
    {
      title: "Assign drop-off / pick-up",
      description: `Set who does drop-off or pick-up for a kid's timed event away from home. The app then creates, moves or removes the drive block on that parent's Google calendar by itself, merging trips when one parent drives two kids.`,
      inputSchema: {
        id: eventId,
        duty: z.enum(["dropoff", "pickup"]),
        assignment: z
          .string()
          .nullable()
          .describe(
            `A parent's email; a caregiver's name (${CAREGIVERS.join(" or ")}: tracked, but nobody gets a drive block); "na" when no drive is needed (already at the venue, carpool); or null to clear it back to undecided.`,
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ id, duty, assignment }) =>
      call(setDuty, "POST", `/events/${id}/duty`, {
        id,
        body: { duty, assignment },
      }),
  );

  server.registerTool(
    "set_teamsnap_rsvp",
    {
      title: "Answer a TeamSnap RSVP",
      description:
        "Set the kid's RSVP for a team event. This is written to TeamSnap itself and the coach sees it, so only send it when the parent has said what the answer is.",
      inputSchema: {
        id: eventId,
        status: z.enum(["going", "maybe", "not_going"]),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ id, status }) =>
      call(setRsvp, "POST", `/events/${id}/rsvp`, { id, body: { status } }),
  );

  return server;
}
