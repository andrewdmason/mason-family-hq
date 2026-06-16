"use client";

// The event panel: one always-editable surface for create, edit, and read-only
// viewing — no detail/edit mode split. Fields edit inline; changes accumulate
// and a save bar slides in when anything is dirty (one batched save, so the
// Google round-trip — and later the recurring this/all prompt — happens once).
// The instant-action sections (going toggles, drop-off/pick-up, TeamSnap RSVP)
// keep their fire-and-forget optimistic behavior, unchanged from the old sheet.
//
// Hosted by EventPanelHost in an anchored popover (desktop) or bottom sheet
// (mobile) — see event-panel-host.tsx.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  MapPin,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/ui/date-field";
import { TimeField } from "@/components/ui/time-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNestedOverlayReporter } from "@/components/ui/nested-overlay";
import {
  allDayInstant,
  formatEventDate,
  formatTimeRange,
  googleMapsUrl,
  toDateKey,
  utcDateKey,
} from "@/lib/calendar/calendar-utils";
import { describeRRule } from "@/lib/calendar/recurrence";
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
  searchLocationSuggestions,
  type ManualEventInput,
  type LocationSuggestion,
} from "@/app/(calendar)/calendar/actions";
import { TeamsnapAttendance } from "./team-availability";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { cn } from "@/lib/utils";

// A not-yet-saved event: the block already drawn on the grid while the panel
// collects details. Owned by calendar-client (which renders it as a synthetic
// CalendarEvent with id "draft:new").
export type DraftEvent = {
  startTime: string; // ISO
  endTime: string | null;
  allDay: boolean;
  memberEmail: string | null;
};

export type PanelMode =
  | { kind: "create"; draft: DraftEvent }
  | { kind: "event"; event: CalendarEvent };

// ---------------------------------------------------------------------------
// Form values: local wall-clock date strings + minutes-since-midnight, the
// shapes DateField/TimeField speak. All-day dates read in UTC (the storage
// anchor — see calendar-utils).
// ---------------------------------------------------------------------------

type FormValues = {
  title: string;
  calendarSourceId: string; // create only; "" = app-only manual event
  ownerEmail: string; // Google events: whose calendar (move on save)
  memberEmail: string; // app-only events: whose event
  allDay: boolean;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  startMin: number;
  endMin: number;
  location: string;
  description: string;
};

function localParts(iso: string): { date: string; min: number } {
  const d = new Date(iso);
  return { date: toDateKey(d), min: d.getHours() * 60 + d.getMinutes() };
}

function partsToIso(date: string, min: number): string {
  const [y, m, dd] = date.split("-").map(Number);
  return new Date(y, m - 1, dd, Math.floor(min / 60), min % 60).toISOString();
}

function epochOf(date: string, min: number): number {
  return +new Date(partsToIso(date, min));
}

function seedValues(
  mode: PanelMode,
  members: CalendarMember[],
  googleSources: CalendarSource[],
): FormValues {
  if (mode.kind === "create") {
    const { draft } = mode;
    const start = draft.allDay
      ? { date: utcDateKey(new Date(draft.startTime)), min: 9 * 60 }
      : localParts(draft.startTime);
    const end = draft.allDay
      ? { date: start.date, min: 10 * 60 }
      : localParts(draft.endTime ?? draft.startTime);
    // Default to the draft owner's Google calendar so the event lands on their
    // real calendar without extra clicks. No calendar of their own → app-only
    // (NOT someone else's calendar — the clicked column says whose event it is).
    const ownSource = googleSources.find(
      (s) => s.member_email === draft.memberEmail,
    );
    return {
      title: "",
      calendarSourceId: ownSource?.id ?? "",
      ownerEmail: "",
      memberEmail: draft.memberEmail ?? "",
      allDay: draft.allDay,
      startDate: start.date,
      endDate: end.date,
      startMin: start.min,
      endMin: Math.max(end.min, start.min + 15),
      location: "",
      description: "",
    };
  }
  const { event } = mode;
  const start = event.all_day
    ? { date: utcDateKey(new Date(event.start_time)), min: 9 * 60 }
    : localParts(event.start_time);
  const end = event.all_day
    ? { date: start.date, min: 10 * 60 }
    : localParts(event.end_time ?? event.start_time);
  return {
    title: event.title,
    calendarSourceId: event.calendar_source_id ?? "",
    ownerEmail: event.member_email ?? "",
    memberEmail: event.member_email ?? members[0]?.email ?? "",
    allDay: event.all_day,
    startDate: start.date,
    endDate: end.date,
    startMin: start.min,
    endMin: event.end_time || event.all_day ? end.min : start.min + 60,
    location: event.location ?? "",
    description: event.description ?? "",
  };
}

export function EventPanelContent({
  mode,
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
  onClose,
  dirtyRef,
  attentionPulse,
}: {
  mode: PanelMode;
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
  onClose: () => void;
  // The host reads this at dismissal time to guard outside-press/Escape while
  // there are unsaved edits. A ref (not a callback) so the panel's keystrokes
  // don't re-render the host.
  dirtyRef: RefObject<boolean>;
  // Bumped by the host when a guarded dismissal is blocked — retriggers the
  // save bar's entrance animation so the user sees why the panel stayed open.
  attentionPulse: number;
}) {
  const event = mode.kind === "event" ? mode.event : null;
  const googleSources = useMemo(
    () => sources.filter((s) => s.source_type === "google"),
    [sources],
  );
  // Manual and Google events are editable; ICS/TeamSnap are synced read-only.
  const editable =
    canManage &&
    (mode.kind === "create" ||
      event!.source_type === "manual" ||
      event!.source_type === "google");
  // Editing a real Google event: the Calendar field becomes a member picker —
  // picking someone else moves the event to THEIR calendar on save.
  const googleEvent =
    event &&
    event.source_type === "google" &&
    event.external_id?.startsWith("google:") &&
    event.calendar_source_id
      ? event
      : null;

  const reportOverlay = useNestedOverlayReporter();
  const [initial] = useState(() => seedValues(mode, members, googleSources));
  const [values, setValues] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Non-fatal outcome of a save (e.g. the event moved but the original
  // couldn't be deleted) — shown instead of closing, so it isn't lost.
  const [notice, setNotice] = useState<string | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(initial),
    [values, initial],
  );
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty, dirtyRef]);

  function patch(p: Partial<FormValues>) {
    setValues((v) => ({ ...v, ...p }));
  }

  // Moving the start drags the end along (duration preserved) — the behavior
  // every calendar app converges on.
  function moveStart(p: { date?: string; min?: number }) {
    setValues((v) => {
      const nextDate = p.date ?? v.startDate;
      const nextMin = p.min ?? v.startMin;
      const duration = epochOf(v.endDate, v.endMin) - epochOf(v.startDate, v.startMin);
      const endEpoch = epochOf(nextDate, nextMin) + Math.max(duration, 15 * 60_000);
      const end = localParts(new Date(endEpoch).toISOString());
      return {
        ...v,
        startDate: nextDate,
        startMin: nextMin,
        endDate: end.date,
        endMin: end.min,
      };
    });
  }

  function moveEnd(p: { date?: string; min?: number }) {
    setValues((v) => {
      const nextDate = p.date ?? v.endDate;
      const nextMin = p.min ?? v.endMin;
      // Never let the end precede the start.
      if (epochOf(nextDate, nextMin) <= epochOf(v.startDate, v.startMin)) {
        return { ...v, endDate: v.startDate, endMin: v.startMin + 15 };
      }
      return { ...v, endDate: nextDate, endMin: nextMin };
    });
  }

  function toggleAllDay(next: boolean) {
    // Keep the picked date; timed mode re-seeds a 9–10 a.m. hour.
    setValues((v) => ({
      ...v,
      allDay: next,
      ...(next ? {} : { startMin: 9 * 60, endMin: 10 * 60, endDate: v.startDate }),
    }));
  }

  const ownerChanged =
    !!googleEvent &&
    !!values.ownerEmail &&
    values.ownerEmail !== (googleEvent.member_email ?? "");

  async function onSave() {
    if (!values.title.trim()) {
      setError("A title is required.");
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    const input: ManualEventInput = {
      calendarSourceId:
        mode.kind === "create"
          ? values.calendarSourceId || null
          : event!.calendar_source_id,
      memberEmail: values.memberEmail || null,
      title: values.title,
      location: values.location || null,
      description: values.description || null,
      // All-day events store midnight UTC of the picked wall-clock date (the
      // canonical anchor every sync path uses); a single date, no end.
      startTime: values.allDay
        ? allDayInstant(values.startDate)
        : partsToIso(values.startDate, values.startMin),
      endTime: values.allDay ? null : partsToIso(values.endDate, values.endMin),
      allDay: values.allDay,
    };
    try {
      if (event) {
        // Field edits land on the event where it lives today; an owner change
        // then moves the freshly-updated event to the new member's calendar.
        await updateManualEvent(event.id, input);
        if (ownerChanged) {
          const res = await onChangeOwner(event.id, values.ownerEmail);
          if (res.warning) {
            setNotice(res.warning);
            setPending(false);
            return;
          }
        }
      } else {
        await createManualEvent(input);
      }
      dirtyRef.current = false;
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the event.");
      setPending(false);
    }
  }

  async function onDelete() {
    if (!event) return;
    setPending(true);
    try {
      await deleteEvent(event.id);
      dirtyRef.current = false;
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the event.");
      setPending(false);
    }
  }

  const isTeamsnap = event?.source_type === "teamsnap";
  const showSaveBar = editable && (mode.kind === "create" || dirty);
  const showAdvancedControls =
    (mode.kind === "create" && googleSources.length > 0) ||
    !!googleEvent ||
    (mode.kind === "event" && !googleEvent && values.calendarSourceId === "") ||
    !!event?.rrule;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header row: title + delete. The title field IS the header — there's
          no mode, so there's no "Edit event" heading either. */}
      <div className="flex items-start gap-1 pt-3 pr-10 pb-1 pl-4">
        {editable ? (
          <input
            value={values.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="New event"
            autoFocus={mode.kind === "create"}
            className="w-full min-w-0 border-none bg-transparent text-base font-medium text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        ) : (
          <h2 className="text-base font-medium text-foreground">
            {event?.title}
          </h2>
        )}
        {editable && event && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            disabled={pending}
            aria-label="Delete event"
            className="-mt-0.5 shrink-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pt-1 pb-3 text-sm">
        {editable ? (
          <>
            {/* When */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1">
                <CalendarDays className="mr-1 h-4 w-4 shrink-0 text-muted-foreground" />
                <DateField
                  value={values.startDate}
                  onChange={(d) =>
                    values.allDay
                      ? patch({ startDate: d, endDate: d })
                      : moveStart({ date: d })
                  }
                />
                {!values.allDay && (
                  <>
                    <TimeField
                      value={values.startMin}
                      onChange={(m) => moveStart({ min: m })}
                      action={{
                        label: "All day",
                        onSelect: () => toggleAllDay(true),
                      }}
                    />
                    <span className="text-muted-foreground">–</span>
                    <TimeField
                      value={values.endMin}
                      baseMinutes={
                        values.endDate === values.startDate
                          ? values.startMin
                          : undefined
                      }
                      onChange={(m) => moveEnd({ min: m })}
                    />
                    {values.endDate !== values.startDate && (
                      <DateField
                        value={values.endDate}
                        onChange={(d) => moveEnd({ date: d })}
                      />
                    )}
                  </>
                )}
                {values.allDay && (
                  <button
                    type="button"
                    onClick={() => toggleAllDay(false)}
                    className="rounded-md px-1.5 py-0.5 text-sm tabular-nums transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    All day
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <MapPin className="mr-1 h-4 w-4 shrink-0 text-muted-foreground" />
              <LocationTypeahead
                value={values.location}
                onChange={(location) => patch({ location })}
              />
            </div>

            <Textarea
              value={values.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Notes"
              rows={2}
              className="min-h-0 resize-none border-none px-1.5 shadow-none focus-visible:bg-accent focus-visible:ring-0 dark:bg-transparent"
            />

            {showAdvancedControls && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((open) => !open)}
                  aria-label={
                    advancedOpen
                      ? "Hide event details"
                      : "Show event details"
                  }
                  aria-expanded={advancedOpen}
                  className="ml-5 flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <ChevronDown
                    className={cn(
                      "size-4 transition-transform",
                      advancedOpen && "rotate-180",
                    )}
                  />
                </button>

                {advancedOpen && (
                  <div className="space-y-2 border-t border-border/60 pt-3">
                    {googleEvent ? (
                      <FieldRow label="Calendar">
                        <Select
                          value={values.ownerEmail}
                          onValueChange={(v) => patch({ ownerEmail: v ?? "" })}
                          onOpenChange={reportOverlay}
                          items={[
                            ...(googleEvent.member_email == null
                              ? [
                                  {
                                    value: "",
                                    label: "Shared calendar (leave as is)",
                                  },
                                ]
                              : []),
                            ...members.map((m) => ({
                              value: m.email,
                              label: m.name ?? m.email,
                            })),
                          ]}
                        >
                          <SelectTrigger size="sm" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {googleEvent.member_email == null && (
                              <SelectItem value="">
                                Shared calendar (leave as is)
                              </SelectItem>
                            )}
                            {members.map((m) => {
                              const receivable =
                                !!m.primary_calendar_id ||
                                m.email === googleEvent.member_email;
                              return (
                                <SelectItem
                                  key={m.email}
                                  value={m.email}
                                  disabled={!receivable}
                                >
                                  {m.name ?? m.email}
                                  {receivable ? "" : " (no Google calendar)"}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                        {ownerChanged && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Saving moves this event to{" "}
                            {members.find((m) => m.email === values.ownerEmail)
                              ?.name ?? values.ownerEmail}
                            &rsquo;s calendar
                            {googleEvent.member_email
                              ? ` — ${
                                  members.find(
                                    (m) =>
                                      m.email === googleEvent.member_email,
                                  )?.name ?? googleEvent.member_email
                                } and current guests stay invited.`
                              : "."}
                          </p>
                        )}
                      </FieldRow>
                    ) : mode.kind === "create" && googleSources.length > 0 ? (
                      <FieldRow label="Calendar">
                        <Select
                          value={values.calendarSourceId}
                          onValueChange={(v) =>
                            patch({ calendarSourceId: v ?? "" })
                          }
                          onOpenChange={reportOverlay}
                          items={[
                            ...googleSources.map((s) => ({
                              value: s.id,
                              label: s.nickname ?? "Google calendar",
                            })),
                            {
                              value: "",
                              label: "App only (no Google calendar)",
                            },
                          ]}
                        >
                          <SelectTrigger size="sm" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {googleSources.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.nickname ?? "Google calendar"}
                              </SelectItem>
                            ))}
                            <SelectItem value="">
                              App only (no Google calendar)
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </FieldRow>
                    ) : mode.kind === "event" &&
                      !googleEvent &&
                      values.calendarSourceId === "" ? (
                      <FieldRow label="Who">
                        <Select
                          value={values.memberEmail}
                          onValueChange={(v) => patch({ memberEmail: v ?? "" })}
                          onOpenChange={reportOverlay}
                          items={members.map((m) => ({
                            value: m.email,
                            label: m.name ?? m.email,
                          }))}
                        >
                          <SelectTrigger size="sm" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {members.map((m) => (
                              <SelectItem key={m.email} value={m.email}>
                                {m.name ?? m.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FieldRow>
                    ) : null}

                    {/* Recurring display (read-only until the repeat picker lands). */}
                    {event?.rrule && (
                      <p className="pl-[4.5rem] text-xs text-muted-foreground">
                        {describeRRule(event.rrule)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          event && (
            <>
              <div className="flex items-start gap-2">
                <CalendarDays className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <div>{formatEventDate(event)}</div>
                  <div className="text-muted-foreground">
                    {formatTimeRange(
                      event.start_time,
                      event.end_time,
                      event.all_day,
                    )}
                    {event.rrule && ` · ${describeRRule(event.rrule)}`}
                  </div>
                  {/* A TeamSnap game can carry an arrival time earlier than the
                      game start — the row above is the game time, this is the
                      separate "be there by". */}
                  {event.teamsnap_arrival_time &&
                    new Date(event.teamsnap_arrival_time).getTime() <
                      new Date(event.start_time).getTime() && (
                      <div className="text-xs text-muted-foreground">
                        Arrive by{" "}
                        {formatTimeRange(
                          event.teamsnap_arrival_time,
                          null,
                          false,
                        )}
                      </div>
                    )}
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
            </>
          )
        )}

        {/* Instant-action zone: taps act immediately (optimistic), unlike the
            batched fields above. Existing events only — a draft has nothing to
            attach attendance to yet. */}
        {event && (
          <div className="space-y-3 border-t border-border/60 pt-3">
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
        )}
      </div>

      {/* Save bar: slides in when anything is dirty (always present while
          creating). attentionPulse retriggers the entrance animation when the
          host blocks an outside-click dismissal. */}
      {showSaveBar && (
        <div
          key={attentionPulse}
          className="shrink-0 border-t border-border/60 bg-background px-3 py-2 animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
        >
          {error && <p className="pb-1.5 text-xs text-destructive">{error}</p>}
          {notice && (
            <p className="pb-1.5 text-xs text-muted-foreground">{notice}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                dirtyRef.current = false;
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={onSave} disabled={pending}>
              {mode.kind === "create" ? "Create" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// A labeled field row, keeping the label column narrow and quiet.
function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-16 shrink-0 pt-1.5 text-xs text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function LocationTypeahead({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);

  useEffect(() => {
    const query = value.trim();
    if (!focused || query.length < 2) return;

    const seq = ++requestSeq.current;
    const timeout = window.setTimeout(async () => {
      try {
        const next = await searchLocationSuggestions(query);
        if (requestSeq.current === seq) setSuggestions(next);
      } catch {
        if (requestSeq.current === seq) setSuggestions([]);
      }
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [focused, value]);

  function selectSuggestion(suggestion: LocationSuggestion) {
    onChange(suggestion.location);
    requestSeq.current += 1;
    setSuggestions([]);
    setFocused(false);
    inputRef.current?.blur();
  }

  return (
    <div className="relative min-w-0 flex-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next);
          if (next.trim().length < 2) {
            requestSeq.current += 1;
            setSuggestions([]);
          }
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          requestSeq.current += 1;
          setFocused(false);
          setSuggestions([]);
        }}
        placeholder="Location"
        autoComplete="off"
        className="h-7 border-none px-1.5 shadow-none focus-visible:bg-accent focus-visible:ring-0 dark:bg-transparent"
      />
      {focused && suggestions.length > 0 && (
        <div className="absolute top-full left-0 z-20 mt-1 max-h-56 w-full min-w-64 overflow-y-auto rounded-lg bg-popover py-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.placeId}
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                selectSuggestion(suggestion);
              }}
              className="block w-full px-2.5 py-1.5 text-left hover:bg-accent"
            >
              <span className="block truncate text-sm">
                {suggestion.label}
              </span>
              {suggestion.secondary && (
                <span className="block truncate text-xs text-muted-foreground">
                  {suggestion.secondary}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// "Who's going" toggles: one avatar per family member other than the event owner.
// Tap to mark going (full color + ring), tap again to clear (dimmed). For a
// materialized event this adds/removes them as a native Google guest so the event
// lands on their own calendar; for any event it records who's attending.
export function GoingRow({
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
  // across panel open/close) — so the state survives reopening the panel.
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
      <div className="flex items-center gap-3">
        <ActionRowLabel icon={<Users className="size-4" />} label="Going" />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
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
      </div>
      {warning && (
        <p className="pl-[5.75rem] text-xs text-muted-foreground">{warning}</p>
      )}
    </div>
  );
}

// Drop-off / pick-up assignment: one row per duty, same avatar-tap pattern as
// GoingRow plus an "N/A" chip for "no drive needed". Tap a parent to assign
// (full color + ring), tap the selected one to clear back to unset. Taps are
// never blocked: the optimistic state flips instantly and the server work
// (DB write, then the Google drive block in the background) catches up —
// rapid re-clicks are resolved last-write-wins by the calendar client.
export function LogisticsRows({
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
    const isDropoff = duty === "dropoff";
    return (
      <div className="flex items-center gap-3">
        <ActionRowLabel
          icon={
            isDropoff ? (
              <ArrowRight className="size-4" />
            ) : (
              <ArrowLeft className="size-4" />
            )
          }
          label={isDropoff ? "Drop-off" : "Pick-up"}
        />
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
        <p className="pl-[5.75rem] text-xs text-muted-foreground">
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

function ActionRowLabel({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex w-20 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span className="flex size-4 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span>{label}</span>
    </div>
  );
}
