// Blackbaud (myschoolapp.com) portal client. Bentley runs Blackbaud, not
// Blackboard — login is a Blackbaud ID at bentleyschool.myschoolapp.com.
//
// There's no parent-accessible official API without the school provisioning SKY
// API access, so we replay the parent's own logged-in portal session against the
// same internal JSON endpoint the assignment-center page calls:
//
//   GET https://{host}/api/assignment2/ParentStudentAssignmentCenterGet?studentUserId={id}
//
// Auth is the portal session cookie (captured from a logged-in parent), sent as a
// Cookie header. Blackbaud ID is SSO with no refresh grant, so when the cookie
// lapses a parent must reconnect. This module is the equivalent of teamsnap.ts.
//
// Discovered (2026-06-05) supporting endpoints, for building on later:
//   /api/webapp/context                                  - the signed-in user + children
//   /api/datadirect/ParentStudentUserClassesGet          - schedule / classes
//   /api/datadirect/ParentStudentUserPerformance         - report cards / transcript list
//   /api/datadirect/ParentStudentUserAttendance          - attendance
//   /api/Grading/StudentReportCardTemplateList           - report cards
//
// NOTE: when this was first built the school year was ending, so every due-date
// bucket came back empty for both kids and we could not capture a populated
// assignment item. The field mapping in normalizeAssignment() is therefore
// best-effort across the documented Blackbaud field names; we also persist the
// raw item (school_assignments.raw) so nothing is lost before we see live data.

import { createAdminClient } from "@/lib/supabase/admin";
import type { AssignmentStatus } from "./types";

export const DEFAULT_SCHOOL_HOST = "bentleyschool.myschoolapp.com";

/** The due-date buckets the portal groups assignments into. */
const BUCKET_KEYS = [
  "Missing",
  "Overdue",
  "DueToday",
  "DueTomorrow",
  "DueThisWeek",
  "DueNextWeek",
  "DueAfterNextWeek",
  "PastThisWeek",
  "PastLastWeek",
  "PastBeforeLastWeek",
] as const;

/** A raw assignment item as returned inside a bucket. Shape is permissive
 * because the exact keys vary by Blackbaud version and we haven't yet seen a
 * populated payload from this school. */
type RawAssignmentItem = Record<string, unknown>;

export type NormalizedAssignment = {
  externalId: string;
  title: string;
  shortDescription: string | null;
  longDescription: string | null;
  course: string | null;
  assignmentType: string | null;
  dateAssigned: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD
  dueTime: string | null; // HH:MM:SS
  status: AssignmentStatus;
  maxPoints: number | null;
  pointsEarned: number | null;
  raw: RawAssignmentItem;
};

/** A parent's stored portal session, resolved through the service-role client. */
export type BlackbaudConnection = {
  memberEmail: string;
  schoolHost: string;
  sessionCookie: string;
  cookieExpiresAt: string | null;
};

export class BlackbaudSessionError extends Error {}

/**
 * Return the connecting parent's portal session cookie, or throw if there's no
 * connection or the cookie has lapsed (the parent must reconnect — there's no
 * refresh path for a Blackbaud ID SSO session).
 */
export async function getConnection(
  memberEmail: string,
): Promise<BlackbaudConnection> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("blackbaud_connections")
    .select("member_email, school_host, session_cookie, cookie_expires_at")
    .eq("member_email", memberEmail)
    .single();

  if (error || !data) {
    throw new BlackbaudSessionError(
      `No Blackbaud connection for ${memberEmail}`,
    );
  }
  if (data.cookie_expires_at && new Date(data.cookie_expires_at) < new Date()) {
    throw new BlackbaudSessionError(
      `Blackbaud session for ${memberEmail} has expired — reconnect needed`,
    );
  }
  return {
    memberEmail: data.member_email,
    schoolHost: data.school_host ?? DEFAULT_SCHOOL_HOST,
    sessionCookie: data.session_cookie,
    cookieExpiresAt: data.cookie_expires_at,
  };
}

/** Fetch the raw assignment-center payload for one student. */
export async function fetchAssignmentCenter(
  conn: BlackbaudConnection,
  studentUserId: string,
): Promise<Record<string, unknown>> {
  const url = `https://${conn.schoolHost}/api/assignment2/ParentStudentAssignmentCenterGet?studentUserId=${encodeURIComponent(
    studentUserId,
  )}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        Cookie: conn.sessionCookie,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Blackbaud API timeout after 30s: ${url}`);
    }
    throw err;
  }
  clearTimeout(timeout);

  if (res.status === 401 || res.status === 403) {
    throw new BlackbaudSessionError(
      `Blackbaud session rejected (${res.status}) — reconnect needed`,
    );
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Blackbaud API error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/** Flatten every due-date bucket into a de-duplicated list of items. */
export function extractAssignmentItems(
  payload: Record<string, unknown>,
): RawAssignmentItem[] {
  const seen = new Set<string>();
  const items: RawAssignmentItem[] = [];
  for (const key of BUCKET_KEYS) {
    const bucket = payload[key];
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket as RawAssignmentItem[]) {
      const id = String(item.AssignmentId ?? item.AssignmentIndexId ?? "");
      const dedupKey = id || JSON.stringify(item);
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      items.push(item);
    }
  }
  return items;
}

// --- field helpers (defensive: Blackbaud key casing/naming varies) -----------

function firstString(item: RawAssignmentItem, keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function firstNumber(item: RawAssignmentItem, keys: string[]): number | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
  }
  return null;
}

/** Parse a portal date string ("/Date(...)/" or ISO) into YYYY-MM-DD. */
function toDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const msMatch = value.match(/\/Date\((\d+)/);
  const date = msMatch ? new Date(Number(msMatch[1])) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function toTimeOnly(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const msMatch = value.match(/\/Date\((\d+)/);
  const date = msMatch ? new Date(Number(msMatch[1])) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(11, 19);
}

function deriveStatus(item: RawAssignmentItem): AssignmentStatus {
  if (item.MissingInd === 1 || item.Missing === true) return "missing";
  if (item.HasGrade === 1 || item.PublishGrade === 1) return "graded";
  if (item.CollectedInd === true || item.AssignmentStatus === 2)
    return "submitted";
  return "assigned";
}

/** Normalize one raw bucket item into our row shape. */
export function normalizeAssignment(
  item: RawAssignmentItem,
  studentUserId: string,
): NormalizedAssignment {
  const assignmentId = String(item.AssignmentId ?? item.AssignmentIndexId ?? "");
  const title =
    firstString(item, [
      "ShortDescription",
      "AssignmentShortDescription",
      "Title",
      "ShortDescriptionUnformatted",
    ]) ?? "Untitled assignment";

  return {
    externalId: `bb:${studentUserId}:${assignmentId}`,
    title,
    shortDescription: firstString(item, ["ShortDescription", "Abstract"]),
    longDescription: firstString(item, [
      "LongDescription",
      "AssignmentDescription",
      "Description",
    ]),
    course: firstString(item, ["GroupName", "SectionName", "CourseTitle"]),
    assignmentType: firstString(item, ["AssignmentType", "TypeName"]),
    dateAssigned: toDateOnly(item.DateAssigned),
    dueDate: toDateOnly(item.DateDue ?? item.DueDate),
    dueTime: toTimeOnly(item.DateDue ?? item.DueDate),
    status: deriveStatus(item),
    maxPoints: firstNumber(item, ["MaxPoints"]),
    pointsEarned: firstNumber(item, ["Points", "PointsEarned"]),
    raw: item,
  };
}

/** End to end: fetch + parse one student's current assignments. */
export async function getStudentAssignments(
  conn: BlackbaudConnection,
  studentUserId: string,
): Promise<NormalizedAssignment[]> {
  const payload = await fetchAssignmentCenter(conn, studentUserId);
  return extractAssignmentItems(payload).map((item) =>
    normalizeAssignment(item, studentUserId),
  );
}
