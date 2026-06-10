import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { plainTextToNotesHtml } from "@/lib/todos/notes";

/**
 * Token-authenticated capture endpoint for the Todos app, used by the Apple
 * Reminders iOS Shortcut sweep and the Raycast quick-capture command (no
 * browser session — exempted from auth middleware, authenticated with a
 * personal API token from /todos/settings).
 *
 * POST { items: [{ title, notes?, assignee_email?, project_id?, external_id?, source? }] }
 *   → drops each item into the assignee's Inbox. creator = token owner;
 *     assignee defaults to the token owner. `external_id` makes the call
 *     idempotent (the Reminders sweep can retry safely): one row per
 *     (source, external_id), ever — even across soft-deletes.
 *
 * GET → { members, projects } for the Raycast assignee/project dropdowns.
 */

type IngestItem = {
  title?: unknown;
  notes?: unknown;
  assignee_email?: unknown;
  project_id?: unknown;
  external_id?: unknown;
  source?: unknown;
};

type TokenContext = {
  memberEmail: string;
};

async function authenticate(request: NextRequest): Promise<TokenContext | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const admin = createAdminClient();
  const { data } = await admin
    .from("todo_api_tokens")
    .select("id, member_email")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!data) return null;

  await admin
    .from("todo_api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return { memberEmail: data.member_email as string };
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { items?: IngestItem[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0 || items.length > 100) {
    return NextResponse.json(
      { error: "Provide 1–100 items" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const results: { status: "created" | "duplicate" | "error"; id?: string; error?: string }[] = [];

  for (const item of items) {
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title) {
      results.push({ status: "error", error: "title is required" });
      continue;
    }
    const source =
      item.source === "raycast" || item.source === "reminders"
        ? item.source
        : "raycast";
    const externalId =
      typeof item.external_id === "string" && item.external_id.trim() !== ""
        ? item.external_id.trim()
        : null;
    const assigneeEmail =
      typeof item.assignee_email === "string" && item.assignee_email.trim() !== ""
        ? item.assignee_email.trim().toLowerCase()
        : auth.memberEmail;
    const projectId =
      typeof item.project_id === "string" && item.project_id.trim() !== ""
        ? item.project_id.trim()
        : null;
    const notes =
      typeof item.notes === "string" ? plainTextToNotesHtml(item.notes) : null;

    // Append to the end of the assignee's inbox.
    const { data: last } = await admin
      .from("todo_tasks")
      .select("sort_order")
      .eq("assignee_email", assigneeEmail)
      .eq("bucket", "inbox")
      .is("completed_at", null)
      .is("deleted_at", null)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const row = {
      title,
      notes_html: notes,
      // A project capture is already triaged — it can't sit in the Inbox.
      bucket: projectId ? "anytime" : "inbox",
      assignee_email: assigneeEmail,
      creator_email: auth.memberEmail,
      project_id: projectId,
      sort_order: (last?.sort_order ?? 0) + 1,
      assignee_seen_at:
        assigneeEmail === auth.memberEmail ? new Date().toISOString() : null,
      external_source: externalId ? source : null,
      external_id: externalId,
    };

    if (externalId) {
      // Idempotent path: ON CONFLICT (external_source, external_id) DO NOTHING.
      const { data, error } = await admin
        .from("todo_tasks")
        .upsert(row, {
          onConflict: "external_source,external_id",
          ignoreDuplicates: true,
        })
        .select("id")
        .maybeSingle();
      if (error) {
        results.push({ status: "error", error: error.message });
      } else if (data) {
        results.push({ status: "created", id: data.id as string });
      } else {
        results.push({ status: "duplicate" });
      }
    } else {
      const { data, error } = await admin
        .from("todo_tasks")
        .insert(row)
        .select("id")
        .single();
      if (error || !data) {
        results.push({ status: "error", error: error?.message ?? "insert failed" });
      } else {
        results.push({ status: "created", id: data.id as string });
      }
    }
  }

  return NextResponse.json({ items: results });
}

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const [{ data: members }, { data: projects }] = await Promise.all([
    admin.from("family_members").select("email, name").order("created_at"),
    admin
      .from("todo_projects")
      .select("id, name, todo_project_members(member_email)")
      .is("completed_at", null)
      .is("deleted_at", null)
      .order("sort_order"),
  ]);

  return NextResponse.json({
    members: (members ?? []).map((m) => ({ email: m.email, name: m.name })),
    projects: (projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      member_emails: (
        p.todo_project_members as { member_email: string }[]
      ).map((m) => m.member_email),
    })),
  });
}
