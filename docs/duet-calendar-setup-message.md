# Setting up Claude Duet for the family calendar

Duet won't store a secret or send one in a request, so it can't call the
agent API (`/api/agent/calendar/*`) directly the way Norbert did. It reaches
Family HQ through a custom connector instead: the app serves the same calendar
operations over MCP at `/api/agent/mcp`, and the bearer secret lives in the
connector's settings, where the assistant never sees it.

## 1. Add the connector (you, in Claude's settings)

In Claude's connector settings, add a custom connector:

- **Name:** Family HQ
- **URL:** `https://<your Family HQ domain>/api/agent/mcp`
- **Sign in:** none. Under request headers add
  `Authorization` = `Bearer <AGENT_API_SECRET>`

Connectors are set on your Claude account, so Duet picks it up from there.

## 2. Paste this into Duet

Everything below the line is the message.

---

I've added a connector called Family HQ. I want you to use it to take over managing my family's calendar. Please read this whole message, save the rules, and run the check at the end.

## Background

My family runs on an app I built called Family HQ. It is the family's calendar hub: it pulls every source into one place (the kids' TeamSnap teams, school calendar feeds, and everyone's Google calendars), and it holds family state that Google Calendar doesn't have:

- whether a kid is actually going to one of their events
- which parent is attending a kid's event
- who is doing drop-off and pick-up (the app then puts drive-time blocks on that parent's real Google calendar by itself)
- the kids' TeamSnap RSVPs

The Family HQ connector's tools cover all of it: reading the schedule, a "what needs attention" review, creating and changing events, kid attendance, parent attendance, drop-off/pick-up, and TeamSnap RSVPs.

## The rules, and why

1. **Use the Family HQ connector for all family scheduling.**
2. **Don't use the Google Calendar connector for family events, for reading or writing.** Events you create through Family HQ land on the right person's real Google calendar automatically. If you write to Google yourself, the app sees a second copy it can't reconcile and we get duplicates. Reading Google directly also gives you a worse picture, because it lacks the attendance and driving state. (My non-family work meetings are a separate matter; this rule is about the family schedule.)
3. **Never edit or delete drive blocks.** They are generated from the drop-off/pick-up assignments. Change the assignment and the block follows.
4. **When to act and when to ask:**
   - Reads: any time, no need to ask.
   - If I tell you something directly ("I'll take drop-off Thursday", "Oscar's skipping Saturday", "put the dentist on Jenny's calendar at 2"), do it and tell me what you did.
   - If it's your own idea (a fix for a conflict, a guess at who should drive), propose it and wait for my yes.
   - Always ask before deleting an event, and before sending a TeamSnap RSVP I didn't explicitly ask for. The RSVP is visible to the coach.
5. Marking a kid not going doesn't tell TeamSnap. If the coach needs to know, ask me whether to send the RSVP too.
6. If a tool returns an error, tell me the exact message. Don't retry in a loop, and don't fall back to Google Calendar.

## How to resolve things

- **Conflict:** tell me both events and ask which gives way. Then move or delete the losing event if it's ours to change, or mark the kid not going if it's a synced TeamSnap or school event being skipped. Some overlaps are fine (a reminder that overlaps a drive block), so use judgment and don't raise the same harmless one every day.
- **Missing drop-off or pick-up:** look at both parents' events around that time, propose who drives, and set it once I confirm. If we'll already be at the venue or another family is carpooling, set it to "na".
- **Unanswered TeamSnap RSVP:** ask me whether the kid is going, then send it.
- **No parent going:** for games especially, ask which parent, if either, is attending, and mark them going.

## Setup steps

1. Save the rules above as standing instructions, so they apply in every channel and in background work, not just this chat. If you can save them as a skill, name it `family-calendar`.
2. Each morning, before the morning brief: sync the calendar, then get the review for the next 7 days. Put anything unresolved in the brief (conflicts, unassigned drop-off or pick-up, unanswered TeamSnap RSVPs, kid events with no parent going), each with a proposed fix I can say yes to. If the Family HQ tools aren't available during a background run, say so in the brief rather than using Google Calendar instead.
3. When I ask "what does our day/week look like", answer from Family HQ's events, and include who is driving and who is going, not only times.
4. Check that it works now: get the family context, then the review for the next 7 days, and reply with one paragraph: who you can see in the family, and what currently needs attention. If you don't see the Family HQ tools, or a call fails, tell me exactly what happened.
