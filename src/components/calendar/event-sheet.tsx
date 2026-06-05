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
  formatTimeRange,
  googleMapsUrl,
} from "@/lib/calendar/calendar-utils";
import type { CalendarEvent, CalendarMember } from "@/lib/calendar/types";
import {
  createManualEvent,
  updateManualEvent,
  deleteEvent,
  type ManualEventInput,
} from "@/app/(calendar)/calendar/actions";
import { TeamsnapAttendance } from "./team-availability";

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

export function EventSheet({
  open,
  onOpenChange,
  mode,
  onModeChange,
  event,
  members,
  canManage,
  canRsvp,
  sourceLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SheetMode;
  onModeChange: (mode: SheetMode) => void;
  event: CalendarEvent | null;
  members: CalendarMember[];
  canManage: boolean;
  canRsvp: boolean;
  sourceLabel: string | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {mode === "detail" && event ? (
          <DetailBody
            event={event}
            sourceLabel={sourceLabel}
            canManage={canManage}
            canRsvp={canRsvp}
            onEdit={() => onModeChange("edit")}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <EventForm
            event={mode === "edit" ? event : null}
            members={members}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({
  event,
  sourceLabel,
  canManage,
  canRsvp,
  onEdit,
  onClose,
}: {
  event: CalendarEvent;
  sourceLabel: string | null;
  canManage: boolean;
  canRsvp: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const isManual = event.source_type === "manual";
  const isTeamsnap = event.source_type === "teamsnap";
  const date = new Date(event.start_time).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

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
      </div>
      {canManage && isManual && (
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

function EventForm({
  event,
  members,
  onDone,
}: {
  event: CalendarEvent | null;
  members: CalendarMember[];
  onDone: () => void;
}) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [memberEmail, setMemberEmail] = useState<string>(
    event?.member_email ?? "",
  );
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [start, setStart] = useState(
    toLocalInput(event?.start_time ?? new Date().toISOString()),
  );
  const [end, setEnd] = useState(toLocalInput(event?.end_time ?? null));
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    if (!title.trim() || !start) {
      setError("A title and start time are required.");
      return;
    }
    setPending(true);
    setError(null);
    const input: ManualEventInput = {
      memberEmail: memberEmail || null,
      title,
      location: location || null,
      description: description || null,
      startTime: fromLocalInput(start),
      endTime: end ? fromLocalInput(end) : null,
      allDay,
    };
    try {
      if (event) {
        await updateManualEvent(event.id, input);
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
        <div className="space-y-1.5">
          <Label htmlFor="ev-member">Whose calendar</Label>
          <select
            id="ev-member"
            value={memberEmail}
            onChange={(e) => setMemberEmail(e.target.value)}
            className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">Family (everyone)</option>
            {members.map((m) => (
              <option key={m.email} value={m.email}>
                {m.name ?? m.email}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="ev-allday">All day</Label>
          <Switch id="ev-allday" checked={allDay} onCheckedChange={setAllDay} />
        </div>
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
