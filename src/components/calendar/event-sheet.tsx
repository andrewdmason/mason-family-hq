"use client";

import { useState } from "react";
import { CalendarDays, MapPin, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  allDayInstant,
  formatEventDate,
  formatTimeRange,
  googleMapsUrl,
  utcDateKey,
} from "@/lib/calendar/calendar-utils";
import type {
  CalendarEvent,
  CalendarMember,
  CalendarSource,
  EventDuties,
  EventDuty,
} from "@/lib/calendar/types";
import {
  createManualEvent,
  updateManualEvent,
  deleteEvent,
  type ManualEventInput,
} from "@/app/(calendar)/calendar/actions";
import { TeamsnapAttendance } from "./team-availability";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { cn } from "@/lib/utils";

export type SheetMode = "detail" | "edit" | "create";

// ISO string -> value for <input type="datetime-local"> in local time.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

// All-day events bind to a wall-clock date, so the form edits a plain
// <input type="date"> (YYYY-MM-DD). The stored value is the date read in UTC,
// where every all-day event is anchored.
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  return utcDateKey(new Date(iso));
}

export function EventSheet({
  open,
  onOpenChange,
  mode,
  onModeChange,
  event,
  members,
  sources,
  canManage,
  canRsvp,
  sourceLabel,
  going,
  onToggleGoing,
  onChangeOwner,
  duties,
  parents,
  showLogistics,
  onSetDuty,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SheetMode;
  onModeChange: (mode: SheetMode) => void;
  event: CalendarEvent | null;
  members: CalendarMember[];
  sources: CalendarSource[];
  canManage: boolean;
  canRsvp: boolean;
  sourceLabel: string | null;
  going: string[];
  onToggleGoing: (
    eventId: string,
    email: string,
    willGo: boolean,
  ) => Promise<{ warning?: string }>;
  onChangeOwner: (
    eventId: string,
    email: string,
  ) => Promise<{ warning?: string }>;
  duties: EventDuties;
  parents: CalendarMember[];
  showLogistics: boolean;
  onSetDuty: (
    eventId: string,
    duty: "dropoff" | "pickup",
    state: EventDuty | null,
  ) => Promise<void>;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {mode === "detail" && event ? (
          <DetailBody
            event={event}
            members={members}
            sourceLabel={sourceLabel}
            canManage={canManage}
            canRsvp={canRsvp}
            going={going}
            onToggleGoing={onToggleGoing}
            duties={duties}
            parents={parents}
            showLogistics={showLogistics}
            onSetDuty={onSetDuty}
            onEdit={() => onModeChange("edit")}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <EventForm
            event={mode === "edit" ? event : null}
            members={members}
            sources={sources}
            onChangeOwner={onChangeOwner}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({
  event,
  members,
  sourceLabel,
  canManage,
  canRsvp,
  going,
  onToggleGoing,
  duties,
  parents,
  showLogistics,
  onSetDuty,
  onEdit,
  onClose,
}: {
  event: CalendarEvent;
  members: CalendarMember[];
  sourceLabel: string | null;
  canManage: boolean;
  canRsvp: boolean;
  going: string[];
  onToggleGoing: (
    eventId: string,
    email: string,
    willGo: boolean,
  ) => Promise<{ warning?: string }>;
  duties: EventDuties;
  parents: CalendarMember[];
  showLogistics: boolean;
  onSetDuty: (
    eventId: string,
    duty: "dropoff" | "pickup",
    state: EventDuty | null,
  ) => Promise<void>;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  // Manual and Google events are editable here; ICS/TeamSnap are read-only.
  const isEditable =
    event.source_type === "manual" || event.source_type === "google";
  const isTeamsnap = event.source_type === "teamsnap";
  const date = formatEventDate(event);

  async function onDelete() {
    setPending(true);
    try {
      await deleteEvent(event.id);
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{event.title}</SheetTitle>
      </SheetHeader>
      <div className="space-y-3 px-4 text-sm">
        <div className="flex items-start gap-2">
          <CalendarDays className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <div>{date}</div>
            <div className="text-muted-foreground">
              {formatTimeRange(event.start_time, event.end_time, event.all_day)}
            </div>
          </div>
        </div>
        {event.location && (
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <a
              href={googleMapsUrl(event.location)}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              {event.location}
            </a>
          </div>
        )}
        {sourceLabel && (
          <div className="text-muted-foreground">{sourceLabel}</div>
        )}
        {event.teamsnap_opponent && (
          <div className="text-muted-foreground">
            vs. {event.teamsnap_opponent}
          </div>
        )}
        {event.description && (
          <p className="whitespace-pre-wrap text-foreground">
            {event.description}
          </p>
        )}
        {isTeamsnap && (
          <TeamsnapAttendance
            key={`ts-${event.id}`}
            eventId={event.id}
            canRsvp={canRsvp}
          />
        )}
        <GoingRow
          key={`going-${event.id}`}
          event={event}
          members={members}
          going={going}
          canManage={canManage}
          onToggleGoing={onToggleGoing}
        />
        {showLogistics && (
          <LogisticsRows
            key={`duty-${event.id}`}
            event={event}
            parents={parents}
            duties={duties}
            canManage={canManage}
            onSetDuty={onSetDuty}
          />
        )}
      </div>
      {canManage && isEditable && (
        <SheetFooter className="flex-row justify-between">
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={pending}
          >
            <Trash2 />
            Delete
          </Button>
          <Button size="sm" onClick={onEdit} disabled={pending}>
            Edit
          </Button>
        </SheetFooter>
      )}
    </>
  );
}

// "Who's going" toggles: one avatar per family member other than the event owner.
// Tap to mark going (full color + ring), tap again to clear (dimmed). For a
// materialized event this adds/removes them as a native Google guest so the event
// lands on their own calendar; for any event it records who's attending.
function GoingRow({
  event,
  members,
  going,
  canManage,
  onToggleGoing,
}: {
  event: CalendarEvent;
  members: CalendarMember[];
  going: string[];
  canManage: boolean;
  onToggleGoing: (
    eventId: string,
    email: string,
    willGo: boolean,
  ) => Promise<{ warning?: string }>;
}) {
  const others = members.filter((m) => m.email !== event.member_email);
  const [pending, setPending] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  if (others.length === 0) return null;
  // App-only manual events have no real Google event to invite guests to, so the
  // toggle couldn't deliver anything — don't offer it. (Manual events written to
  // a Google calendar are source_type "google" and keep the row.)
  if (event.source_type === "manual") return null;
  // Driven by the `going` prop, which lives in the calendar client (mounted
  // across drawer open/close) — so the state survives reopening the drawer.
  const goingSet = new Set(going);

  async function toggle(email: string) {
    const willGo = !goingSet.has(email);
    setPending(email);
    setWarning(null);
    try {
      const res = await onToggleGoing(event.id, email, willGo);
      if (res.warning) setWarning(res.warning);
    } catch {
      // The parent reverts its optimistic state on failure.
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">Going</div>
      <div className="flex flex-wrap gap-2">
        {others.map((m) => {
          const isGoing = goingSet.has(m.email);
          return (
            <button
              key={m.email}
              type="button"
              disabled={!canManage || pending === m.email}
              onClick={() => toggle(m.email)}
              aria-pressed={isGoing}
              title={`${m.name ?? m.email}${isGoing ? " is going" : ""}`}
              className={cn(
                "rounded-full transition-opacity disabled:cursor-not-allowed",
                isGoing ? "opacity-100" : "opacity-35 hover:opacity-60",
              )}
              style={
                isGoing
                  ? {
                      boxShadow: `0 0 0 2px var(--background), 0 0 0 4px ${m.color ?? "currentColor"}`,
                    }
                  : undefined
              }
            >
              <MemberAvatar name={m.name} size="md" />
            </button>
          );
        })}
      </div>
      {warning && <p className="text-xs text-muted-foreground">{warning}</p>}
    </div>
  );
}

// Drop-off / pick-up assignment: one row per duty, same avatar-tap pattern as
// GoingRow plus an "N/A" chip for "no drive needed". Tap a parent to assign
// (full color + ring), tap the selected one to clear back to unset. Taps are
// never blocked: the optimistic state flips instantly and the server work
// (DB write, then the Google drive block in the background) catches up —
// rapid re-clicks are resolved last-write-wins by the calendar client.
function LogisticsRows({
  event,
  parents,
  duties,
  canManage,
  onSetDuty,
}: {
  event: CalendarEvent;
  parents: CalendarMember[];
  duties: EventDuties;
  canManage: boolean;
  onSetDuty: (
    eventId: string,
    duty: "dropoff" | "pickup",
    state: EventDuty | null,
  ) => Promise<void>;
}) {
  if (parents.length === 0) return null;

  function set(duty: "dropoff" | "pickup", next: EventDuty | null) {
    // Fire and forget; the calendar client owns optimistic state + revert.
    onSetDuty(event.id, duty, next).catch(() => {});
  }

  // The assigned parent has no Google calendar set up — the block shows in the
  // app but can't land on their real calendar yet.
  const unsyncable = (["dropoff", "pickup"] as const)
    .map((d) => duties[d]?.assignee)
    .filter((email): email is string => !!email)
    .map((email) => parents.find((p) => p.email === email))
    .filter((p) => p && !p.primary_calendar_id);

  function row(duty: "dropoff" | "pickup") {
    const current = duties[duty];
    return (
      <div className="flex items-center gap-3">
        <div className="w-20 shrink-0 text-xs font-medium text-muted-foreground">
          {duty === "dropoff" ? "→ Drop-off" : "← Pick-up"}
        </div>
        <div className="flex items-center gap-2">
          {parents.map((p) => {
            const selected = current?.assignee === p.email;
            return (
              <button
                key={p.email}
                type="button"
                disabled={!canManage}
                onClick={() =>
                  set(
                    duty,
                    selected ? null : { assignee: p.email, isNa: false },
                  )
                }
                aria-pressed={selected}
                title={`${p.name ?? p.email}${selected ? ` is doing ${duty === "dropoff" ? "drop-off" : "pick-up"}` : ""}`}
                className={cn(
                  "rounded-full transition-opacity disabled:cursor-not-allowed",
                  selected ? "opacity-100" : "opacity-35 hover:opacity-60",
                )}
                style={
                  selected
                    ? {
                        boxShadow: `0 0 0 2px var(--background), 0 0 0 4px ${p.color ?? "currentColor"}`,
                      }
                    : undefined
                }
              >
                <MemberAvatar name={p.name} size="md" />
              </button>
            );
          })}
          <button
            type="button"
            disabled={!canManage}
            onClick={() =>
              set(duty, current?.isNa ? null : { assignee: null, isNa: true })
            }
            aria-pressed={!!current?.isNa}
            title="No drive needed"
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed",
              current?.isNa
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground opacity-60 hover:opacity-100",
            )}
          >
            N/A
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {row("dropoff")}
      {row("pickup")}
      {unsyncable.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {unsyncable
            .map((p) => p?.name ?? p?.email)
            .join(" and ")}{" "}
          has no Google calendar connected — the drive time shows here but
          won&rsquo;t reach their real calendar yet.
        </p>
      )}
    </div>
  );
}

function EventForm({
  event,
  members,
  sources,
  onChangeOwner,
  onDone,
}: {
  event: CalendarEvent | null;
  members: CalendarMember[];
  sources: CalendarSource[];
  onChangeOwner: (
    eventId: string,
    email: string,
  ) => Promise<{ warning?: string }>;
  onDone: () => void;
}) {
  // Writable targets: connected Google calendars. "" = app-only manual event.
  const googleSources = sources.filter((s) => s.source_type === "google");
  const isEditingExisting = !!event;
  // Editing a real Google event: the Calendar field becomes a member picker —
  // picking someone else moves the event to THEIR calendar on save (re-created
  // there with the previous owner + guests invited, original deleted).
  const googleEvent =
    event &&
    event.source_type === "google" &&
    event.external_id?.startsWith("google:") &&
    event.calendar_source_id
      ? event
      : null;
  const [title, setTitle] = useState(event?.title ?? "");
  const [memberEmail, setMemberEmail] = useState<string>(
    event?.member_email ?? members[0]?.email ?? "",
  );
  // The owner picked in the Calendar field for a Google event ("" = an owner-
  // less shared-calendar event left where it is).
  const [ownerEmail, setOwnerEmail] = useState<string>(
    event?.member_email ?? "",
  );
  // Default new events to the first Google calendar when one exists, so the
  // common case (event lands on your real calendar) needs no extra click.
  const [calendarSourceId, setCalendarSourceId] = useState<string>(
    event?.calendar_source_id ?? (event ? "" : googleSources[0]?.id ?? ""),
  );
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [start, setStart] = useState(() =>
    event?.all_day
      ? toDateInput(event.start_time)
      : toLocalInput(event?.start_time ?? new Date().toISOString()),
  );
  const [end, setEnd] = useState(() =>
    event?.all_day
      ? toDateInput(event.end_time)
      : toLocalInput(event?.end_time ?? null),
  );

  // Flip the start/end fields between a datetime and a bare date so they stay
  // valid for the input type and the user keeps what they already entered.
  function toggleAllDay(next: boolean) {
    setStart((s) =>
      s ? (next ? s.slice(0, 10) : `${s.slice(0, 10)}T09:00`) : s,
    );
    setEnd((e) => (e ? (next ? e.slice(0, 10) : `${e.slice(0, 10)}T10:00`) : e));
    setAllDay(next);
  }
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Non-fatal outcome of a save (e.g. the event moved but the original
  // couldn't be deleted) — shown instead of closing, so it isn't lost.
  const [notice, setNotice] = useState<string | null>(null);

  const ownerChanged =
    !!googleEvent && !!ownerEmail && ownerEmail !== (googleEvent.member_email ?? "");

  async function onSave() {
    if (!title.trim() || !start) {
      setError("A title and start time are required.");
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    const input: ManualEventInput = {
      calendarSourceId: calendarSourceId || null,
      memberEmail: memberEmail || null,
      title,
      location: location || null,
      description: description || null,
      // All-day events store midnight UTC of the picked wall-clock date (the
      // canonical anchor every sync path uses); a single date, no end.
      startTime: allDay ? allDayInstant(start) : fromLocalInput(start),
      endTime: allDay ? null : end ? fromLocalInput(end) : null,
      allDay,
    };
    try {
      if (event) {
        // Field edits land on the event where it lives today; an owner change
        // then moves the freshly-updated event to the new member's calendar.
        await updateManualEvent(event.id, input);
        if (ownerChanged) {
          const res = await onChangeOwner(event.id, ownerEmail);
          if (res.warning) {
            setNotice(res.warning);
            setPending(false);
            return;
          }
        }
      } else {
        await createManualEvent(input);
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the event.");
      setPending(false);
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{event ? "Edit event" : "New event"}</SheetTitle>
      </SheetHeader>
      <div className="space-y-3 px-4">
        <div className="space-y-1.5">
          <Label htmlFor="ev-title">Title</Label>
          <Input
            id="ev-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Soccer practice"
          />
        </div>
        {googleEvent ? (
          // Editing a Google event: pick whose calendar it belongs on. Members
          // without a primary calendar can't receive a Google event.
          <div className="space-y-1.5">
            <Label htmlFor="ev-owner">Calendar</Label>
            <select
              id="ev-owner"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {googleEvent.member_email == null && (
                <option value="">Shared calendar (leave as is)</option>
              )}
              {members.map((m) => {
                const receivable =
                  !!m.primary_calendar_id || m.email === googleEvent.member_email;
                return (
                  <option key={m.email} value={m.email} disabled={!receivable}>
                    {m.name ?? m.email}
                    {receivable ? "" : " (no Google calendar)"}
                  </option>
                );
              })}
            </select>
            {ownerChanged && (
              <p className="text-xs text-muted-foreground">
                Saving moves this event to{" "}
                {members.find((m) => m.email === ownerEmail)?.name ?? ownerEmail}
                &rsquo;s calendar
                {googleEvent.member_email
                  ? ` — ${
                      members.find((m) => m.email === googleEvent.member_email)
                        ?.name ?? googleEvent.member_email
                    } and current guests stay invited.`
                  : "."}
              </p>
            )}
          </div>
        ) : (
          googleSources.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="ev-calendar">Calendar</Label>
              <select
                id="ev-calendar"
                value={calendarSourceId}
                onChange={(e) => setCalendarSourceId(e.target.value)}
                // Only a Google event can move between calendars (handled above);
                // an existing app-only event keeps its (lack of a) calendar.
                disabled={isEditingExisting}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
              >
                {googleSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nickname ?? "Google calendar"}
                  </option>
                ))}
                <option value="">App only (no Google calendar)</option>
              </select>
            </div>
          )
        )}

        {/* Whose calendar only applies to app-only events; a Google event belongs
            to whoever owns the chosen calendar. */}
        {calendarSourceId === "" && (
          <div className="space-y-1.5">
            <Label htmlFor="ev-member">Whose calendar</Label>
            <select
              id="ev-member"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {members.map((m) => (
                <option key={m.email} value={m.email}>
                  {m.name ?? m.email}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-center justify-between">
          <Label htmlFor="ev-allday">All day</Label>
          <Switch
            id="ev-allday"
            checked={allDay}
            onCheckedChange={toggleAllDay}
          />
        </div>
        {allDay ? (
          <div className="space-y-1.5">
            <Label htmlFor="ev-date">Date</Label>
            <Input
              id="ev-date"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="ev-start">Starts</Label>
              <Input
                id="ev-start"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-end">Ends</Label>
              <Input
                id="ev-end"
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ev-location">Location</Label>
          <Input
            id="ev-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-desc">Notes</Label>
          <Textarea
            id="ev-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      </div>
      <SheetFooter className="flex-row justify-end">
        <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} disabled={pending}>
          {event ? "Save" : "Create"}
        </Button>
      </SheetFooter>
    </>
  );
}
