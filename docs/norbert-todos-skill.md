---
name: family-todos
description: Read and manage the Mason family's to-dos through Family HQ — see anyone's lists (Inbox/Today/Anytime/Someday, snoozed, delegated, logbook), capture new tasks for any family member, edit/reassign/snooze/complete/delete tasks, and file tasks into shared projects. Use this INSTEAD of Apple Reminders, Things, or any other task tool for anything involving family to-dos.
---

# Family HQ to-dos

Family HQ is also the family's to-do system (a shared, Things-style app).
Every family member has their own lists; tasks can be assigned to anyone,
filed into shared projects, snoozed, and delegated. This API is the same data
the family sees in the app — **all family to-dos live here and only here.
Never use Apple Reminders, Things, or any other task tool for family tasks.**

## Setup

Same two environment variables as the family-calendar skill (one secret
covers the whole Family HQ agent API):

- `FAMILY_HQ_URL` — the app's base URL
- `FAMILY_HQ_AGENT_SECRET` — the bearer token

Every request:

```bash
curl -s -H "Authorization: Bearer $FAMILY_HQ_AGENT_SECRET" \
  "$FAMILY_HQ_URL/api/agent/todos/<endpoint>"
```

## How the family's to-dos work

- Every task has an **assignee** (whose list it's on) and a **creator** (who
  asked for it). When they differ, the app shows a "from X" chip and pings
  the assignee's Inbox bell — so always set `creator_email` to whichever
  family member actually asked you to add the task.
- Each person's active tasks sit in one of four **buckets**: `inbox` (not
  yet triaged), `today`, `anytime`, `someday`.
- A **snoozed** task is hidden until its wake time, then pops into Today.
- **Projects** are shared checklists (dinner party, vacation packing); tasks
  in a project can be assigned to different people. A task in a project is
  never in the Inbox — filing it IS the triage (it becomes `anytime`).
- **Sections** are headings inside a project ("Costco", "Permits"). You can
  *see* them — tasks report `section` / `section_id`, and the context lists
  each project's sections — but you can't file into one. Anything you put in
  a project lands in its unsectioned top area; a human sorts it from there.

## Who's who and what exists

`GET /api/agent/todos/context` returns the family members (name, email,
role), the live projects (id, name, area, members, open-task counts, and
their sections), and the areas. Fetch it once per session to map names to
emails and project names to ids.

## Reading lists

```
GET /api/agent/todos/tasks                          # every open task, all members
GET /api/agent/todos/tasks?member=jenny@mason.io    # one person's open tasks
GET /api/agent/todos/tasks?member=...&view=today    # one sidebar view
GET /api/agent/todos/tasks?project=<id>             # a project's tasks
GET /api/agent/todos/tasks?q=dentist                # title search
GET /api/agent/todos/tasks/<id>                     # one task
```

`view` is one of `inbox` / `today` / `anytime` / `someday` (active tasks in
that bucket), `snoozed` (waiting to wake; `snoozed_until` says when),
`delegated` (tasks that member created for OTHER people — needs `member`),
or `logbook` (completed, newest first). With no `view` you get all active
tasks including snoozed ones. Filters combine.

Task `notes` come back as plain text; checklist items inside notes read as
`[ ]` / `[x]` lines.

## Creating tasks

```bash
curl -s -X POST -H "Authorization: Bearer $FAMILY_HQ_AGENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"title": "Buy soccer cleats", "assignee_email": "jenny@mason.io",
       "creator_email": "andrew@mason.io", "notes": "Size 6, before Saturday"}' \
  "$FAMILY_HQ_URL/api/agent/todos/tasks"
```

Required: `title`, `assignee_email`. Optional:

- `creator_email` — who asked for it (defaults to the assignee). Tasks where
  creator ≠ assignee land unseen in the assignee's Inbox and ping their bell.
- `bucket` — defaults to `inbox`. Don't pre-triage someone else's task
  unless they told you where it goes; Inbox is the polite default.
- `project_id` — files it into a project (becomes `anytime`). If the
  assignee isn't a project member yet they're added automatically.
- `notes` — plain text (line breaks preserved).
- `snoozed_until` — ISO datetime; hides it until then.

## Editing tasks

`PATCH /api/agent/todos/tasks/<id>` with any of:

| Field | Effect |
|---|---|
| `"title"` | retitle |
| `"notes"` | replace notes wholesale (plain text; `null` clears). Careful: rewriting notes flattens any checklist formatting — read first and only rewrite when asked. |
| `"bucket"` | move between inbox/today/anytime/someday (clears any snooze; moving to `inbox` also un-files it from its project) |
| `"assignee_email"` | hand to someone else — lands in their Inbox unseen (unless it's a project task, which stays put) |
| `"project_id"` | file into a project (`null` = remove from project). Lands in the project's top area — it never picks a section |
| `"snoozed_until"` | ISO = snooze until then; `null` = wake it now (lands in Today) |
| `"completed": true` | check it off — include `"completed_by_email"` if someone other than the assignee did it |
| `"completed": false` | un-complete (back from the Logbook) |
| `"deleted": false` | restore a deleted task |

`DELETE /api/agent/todos/tasks/<id>` soft-deletes. There's no Trash in the
app, so if you delete the wrong thing, restore it yourself with
`PATCH {"deleted": false}`. Prefer completing over deleting — delete only
for things that genuinely shouldn't exist (duplicates, mistakes).

## Projects

`POST /api/agent/todos/projects` with `{"name": "...", "member_emails":
["..."], "area_id"?: "..."}` creates a shared project. Renaming, completing,
and deleting projects stay in the app — ask a parent to do those there.

## Playbook

- **"Add X to my list / remind me to X"** → POST with that person as both
  assignee and creator. Inbox unless they said when ("today", "sometime" =
  someday).
- **"Ask/tell Jenny to X"** → assignee Jenny, creator = whoever asked. The
  app's bell tells her there's something new from them.
- **"What's on my plate today?"** → `view=today` for them; mention snoozed
  tasks waking today if relevant.
- **"Remind me about X on Friday"** → if it's a task, create it snoozed
  until Friday morning — that's what snooze is for. Use the calendar only
  for real time-and-place events.
- **"Did anyone buy the cleats?"** → search `q=cleats`, check `completed_at`
  / `completed_by` (logbook view shows recent completions).
- **Weekly/morning review** (if asked to include to-dos in the brief): each
  parent's `view=today` count and anything notable in their `inbox` (a big
  unseen pile means delegated tasks are going unread).
- Don't reorder, re-bucket, or reassign tasks you didn't create unless asked
  — the lists are personally curated.
