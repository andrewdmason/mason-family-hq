"use client";

import { useEffect, useState, useTransition } from "react";
import {
  CalendarCheck,
  Link2,
  Pencil,
  Plus,
  Rss,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  CalendarMember,
  CalendarSource,
  CalendarSourceType,
} from "@/lib/calendar/types";
import type { GoogleCalendarListEntry } from "@/lib/calendar/google";
import {
  addIcsSource,
  addTeamsnapSource,
  addGoogleSource,
  deleteSource,
  renameSource,
  listTeamsnapTeams,
  listTeamsnapPlayers,
  relinkTeamsnapPlayer,
  listGoogleCalendarsForConnection,
  setupManagedPrimary,
  setConnectedPrimary,
  clearPrimaryCalendar,
  listManagedCalendars,
} from "@/app/(calendar)/calendar/actions";

const SOURCE_TYPE_LABELS: Record<CalendarSourceType, string> = {
  google: "Google",
  teamsnap: "TeamSnap",
  ics: "ICS",
  manual: "Manual",
};

// One group per family member, plus a trailing "Family (everyone)" group whose
// member is null (member_email IS NULL). The whole page is organized around the
// idea that each person has ONE primary Google calendar, and their TeamSnap teams
// and school feeds import into it.
export function CalendarsManager({
  members,
  sources,
  teamsnapConnected,
  googleConnectedEmails,
  currentUserEmail,
}: {
  members: CalendarMember[];
  sources: CalendarSource[];
  teamsnapConnected: boolean;
  googleConnectedEmails: string[];
  currentUserEmail: string;
}) {
  return (
    <div className="mt-6 space-y-4">
      <p className="text-sm text-muted-foreground">
        Each person has one Google calendar. Their teams and school calendars are
        imported into it automatically, and it&rsquo;s shared with the family.
      </p>
      {members.map((m) => (
        <CalendarGroup
          key={m.email}
          member={m}
          sources={sources.filter((s) => s.member_email === m.email)}
          teamsnapConnected={teamsnapConnected}
          googleConnectedEmails={googleConnectedEmails}
          currentUserEmail={currentUserEmail}
        />
      ))}
    </div>
  );
}

function CalendarGroup({
  member,
  sources,
  teamsnapConnected,
  googleConnectedEmails,
  currentUserEmail,
}: {
  member: CalendarMember;
  sources: CalendarSource[];
  teamsnapConnected: boolean;
  googleConnectedEmails: string[];
  currentUserEmail: string;
}) {
  const name = member.name ?? member.email;
  const color = member.color ?? "#64748b";
  const [adding, setAdding] = useState(false);

  // The primary calendar isn't an "import" of itself — hide a Google source that
  // points at the member's primary calendar from the imports list.
  const importSources = sources.filter(
    (s) =>
      !(
        member.primary_calendar_id &&
        s.source_type === "google" &&
        s.google_calendar_id === member.primary_calendar_id
      ),
  );

  return (
    <section className="rounded-lg border border-border">
      <header className="flex items-center gap-2 px-4 py-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <h3 className="font-serif text-sm font-medium text-foreground">{name}</h3>
      </header>

      <div className="space-y-3 px-4 pb-4">
        <PrimaryCalendar
          member={member}
          isCurrentUser={member.email === currentUserEmail}
          googleConnected={googleConnectedEmails.includes(member.email)}
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Imports into this calendar
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAdding((v) => !v)}
              aria-expanded={adding}
            >
              <Plus />
              Add import
            </Button>
          </div>

          <SourceList sources={importSources} />

          {adding && (
            <AddCalendarForm
              member={member}
              teamsnapConnected={teamsnapConnected}
              onDone={() => setAdding(false)}
            />
          )}
        </div>
      </div>
    </section>
  );
}

// The headline of each person's card: the one calendar everything lands on.
function PrimaryCalendar({
  member,
  isCurrentUser,
  googleConnected,
}: {
  member: CalendarMember;
  isCurrentUser: boolean;
  googleConnected: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (member.primary_calendar_id) {
    const modeLabel =
      member.primary_calendar_mode === "connected"
        ? "Connected via Google sign-in"
        : "Managed by Family HQ";
    // Prefer the calendar's friendly title; fall back to the id.
    const label = member.primary_calendar_summary ?? member.primary_calendar_id;
    const showId = label !== member.primary_calendar_id;
    return (
      <div className="rounded-lg border bg-muted/30 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <CalendarCheck className="h-4 w-4 shrink-0 text-emerald-600" />
              <span className="truncate">{label}</span>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {showId ? `${member.primary_calendar_id} · ` : ""}
              {modeLabel} · shared with the family
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await clearPrimaryCalendar(member.email);
              })
            }
          >
            Change
          </Button>
        </div>
      </div>
    );
  }

  // The signed-in user connects their own calendar; everyone else is set up by
  // an admin via delegation (no login required from them).
  if (isCurrentUser) {
    return <ConnectOwnPrimary member={member} connected={googleConnected} />;
  }
  return <ManagedSetup member={member} />;
}

// Admin sets up a member's calendar via delegation: one click takes their primary
// calendar; "Choose a calendar" lets you pick a different one (e.g. if they keep
// events on a secondary calendar).
function ManagedSetup({ member }: { member: CalendarMember }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [calendars, setCalendars] = useState<GoogleCalendarListEntry[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  function run(override?: { calendarId: string; summary: string }) {
    startTransition(async () => {
      setError(null);
      const r = await setupManagedPrimary(member.email, override);
      if (r && "error" in r) setError(r.error);
    });
  }

  async function loadCalendars() {
    setPicking(true);
    if (calendars) return;
    setLoading(true);
    try {
      setCalendars(await listManagedCalendars(member.email));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load calendars.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed px-3 py-3">
      <p className="text-sm text-muted-foreground">
        No calendar yet. Set one up for {member.name ?? member.email} — no sign-in
        needed from them.
      </p>
      {!picking ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={pending} onClick={() => run()}>
            <CalendarCheck />
            {pending ? "Setting up…" : "Set up calendar"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={loadCalendars}
          >
            Choose a calendar
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {loading && (
            <p className="text-sm text-muted-foreground">Loading calendars…</p>
          )}
          {calendars?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No writable calendars found.
            </p>
          )}
          {calendars && calendars.length > 0 && (
            <ul className="space-y-1.5">
              {calendars.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: c.backgroundColor ?? "#64748b" }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {c.summary}
                    {c.primary ? " (primary)" : ""}
                  </span>
                  <Button
                    size="icon-sm"
                    disabled={pending}
                    onClick={() => run({ calendarId: c.id, summary: c.summary })}
                    aria-label="Use this calendar"
                  >
                    <Plus />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// The signed-in user picking one of their own Google calendars as their primary.
function ConnectOwnPrimary({
  member,
  connected,
}: {
  member: CalendarMember;
  connected: boolean;
}) {
  const [calendars, setCalendars] = useState<
    { id: string; summary: string; backgroundColor: string | null }[] | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const list = await listGoogleCalendarsForConnection(member.email);
      setCalendars(
        list.map((c) => ({
          id: c.id,
          summary: c.summary,
          backgroundColor: c.backgroundColor,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load calendars.");
    } finally {
      setLoading(false);
    }
  }

  async function choose(cal: {
    id: string;
    summary: string;
    backgroundColor: string | null;
  }) {
    setPendingId(cal.id);
    setError(null);
    try {
      // Ensure the calendar is also a synced source (so its events show in the
      // app and manual events write back); ignore "already added".
      try {
        await addGoogleSource({
          memberEmail: member.email,
          connectionEmail: member.email,
          googleCalendarId: cal.id,
          nickname: cal.summary,
          color: cal.backgroundColor ?? member.color,
        });
      } catch (e) {
        if (!(e instanceof Error && /already added/i.test(e.message))) throw e;
      }
      const r = await setConnectedPrimary(member.email, cal.id, cal.summary);
      if ("error" in r) throw new Error(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't set the calendar.");
      setPendingId(null);
    }
  }

  if (!connected) {
    return (
      <div className="rounded-lg border border-dashed px-3 py-3">
        <p className="text-sm text-muted-foreground">
          Sign in with Google to connect your calendar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed px-3 py-3">
      <p className="text-sm text-muted-foreground">
        Choose which of your Google calendars is your primary.
      </p>
      <Button size="sm" variant="outline" onClick={load} disabled={loading}>
        {loading ? "Loading…" : calendars ? "Refresh" : "Show my calendars"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {calendars && calendars.length > 0 && (
        <ul className="space-y-1.5">
          {calendars.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: c.backgroundColor ?? "#64748b" }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-sm">{c.summary}</span>
              <Button
                size="icon-sm"
                onClick={() => choose(c)}
                disabled={pendingId !== null}
                aria-label="Use as primary"
              >
                <Plus />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceList({ sources }: { sources: CalendarSource[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await deleteSource(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't remove the calendar.");
      }
    });
  }

  if (sources.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing imported yet.</p>;
  }

  return (
    <>
      <ul className="space-y-1.5">
        {sources.map((s) => (
          <SourceRow
            key={s.id}
            source={s}
            onDelete={() => handleDelete(s.id)}
            deleting={pending}
          />
        ))}
      </ul>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </>
  );
}

/** One imported calendar. The display name is editable inline. */
function SourceRow({
  source,
  onDelete,
  deleting,
}: {
  source: CalendarSource;
  onDelete: () => void;
  deleting: boolean;
}) {
  const currentName =
    source.nickname ?? source.teamsnap_team_name ?? "Calendar";
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(currentName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setName(currentName);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setName(currentName);
    setError(null);
    setEditing(false);
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("A name is required.");
      return;
    }
    if (trimmed === currentName) {
      setEditing(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await renameSource(source.id, trimmed);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't rename the calendar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="rounded-lg border px-3 py-2 text-sm">
      {editing ? (
        <div className="space-y-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            autoFocus
            aria-label="Calendar name"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                cancel();
              }
            }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{currentName}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {SOURCE_TYPE_LABELS[source.source_type]}
              {source.sync_error ? ` · error: ${source.sync_error}` : ""}
            </span>
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={startEditing}
            aria-label="Rename calendar"
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            disabled={deleting}
            aria-label="Remove calendar"
          >
            <Trash2 />
          </Button>
        </div>
      )}
      {source.source_type === "teamsnap" && source.teamsnap_team_id && (
        <TeamsnapPlayerLink source={source} />
      )}
    </li>
  );
}

/** Whether a TeamSnap source is linked to a roster player (needed for RSVP) and
 * lets a parent set or change it inline. */
function TeamsnapPlayerLink({ source }: { source: CalendarSource }) {
  const [editing, setEditing] = useState(false);
  const [players, setPlayers] = useState<{ id: number; name: string }[] | null>(
    null,
  );
  const [playerId, setPlayerId] = useState<string>(
    source.teamsnap_player_member_id
      ? String(source.teamsnap_player_member_id)
      : "",
  );
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkedName = players?.find(
    (p) => String(p.id) === String(source.teamsnap_player_member_id),
  )?.name;

  async function open() {
    setEditing(true);
    if (players || !source.teamsnap_team_id) return;
    setLoading(true);
    setError(null);
    try {
      setPlayers(await listTeamsnapPlayers(source.teamsnap_team_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the roster.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      await relinkTeamsnapPlayer(source.id, playerId ? Number(playerId) : null);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't link the player.");
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        {source.teamsnap_player_member_id ? (
          <span>RSVP linked{linkedName ? ` · ${linkedName}` : ""}</span>
        ) : (
          <span className="text-amber-700 dark:text-amber-400">
            Not linked for RSVP
          </span>
        )}
        <button
          type="button"
          onClick={open}
          className="font-medium text-foreground hover:underline"
        >
          {source.teamsnap_player_member_id ? "Change" : "Link player"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <select
        value={playerId}
        onChange={(e) => setPlayerId(e.target.value)}
        disabled={loading || pending}
        className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value="">
          {loading ? "Loading roster…" : "Not on the roster"}
        </option>
        {players?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing(false)}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={loading || pending}>
          Save
        </Button>
      </div>
    </div>
  );
}

type AddTab = "ics" | "teamsnap";

const TAB_LABELS: Record<AddTab, string> = {
  ics: "ICS link",
  teamsnap: "TeamSnap",
};

function AddCalendarForm({
  member,
  teamsnapConnected,
  onDone,
}: {
  member: CalendarMember;
  teamsnapConnected: boolean;
  onDone: () => void;
}) {
  // Imports feed into the member's primary calendar: ICS feeds and TeamSnap teams.
  const tabs: AddTab[] = ["ics", "teamsnap"];
  const [tab, setTab] = useState<AddTab>("ics");

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
      <div className="inline-flex rounded-lg border p-0.5 text-xs">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              "rounded-md px-2.5 py-1 font-medium transition-colors " +
              (tab === t
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "ics" && <IcsForm member={member} onDone={onDone} />}
      {tab === "teamsnap" && (
        <TeamsnapForm member={member} connected={teamsnapConnected} onDone={onDone} />
      )}
    </div>
  );
}

function IcsForm({
  member,
  onDone,
}: {
  member: CalendarMember | null;
  onDone: () => void;
}) {
  const key = member?.email ?? "family";
  const [nickname, setNickname] = useState("");
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd() {
    if (!url.trim() || !nickname.trim()) {
      setError("A name and URL are required.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await addIcsSource({
        memberEmail: member?.email ?? null,
        nickname,
        icsUrl: url,
        color: member?.color ?? null,
      });
      setNickname("");
      setUrl("");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the calendar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label htmlFor={`ics-name-${key}`}>Name</Label>
        <Input
          id={`ics-name-${key}`}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="School calendar"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`ics-url-${key}`}>ICS URL</Label>
        <Input
          id={`ics-url-${key}`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/calendar.ics"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button size="sm" onClick={onAdd} disabled={pending}>
        <Rss />
        Add import
      </Button>
    </div>
  );
}

function TeamsnapForm({
  member,
  connected,
  onDone,
}: {
  member: CalendarMember;
  connected: boolean;
  onDone: () => void;
}) {
  const [teams, setTeams] = useState<{ id: number; name: string }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(
    null,
  );

  async function loadTeams() {
    setLoading(true);
    setError(null);
    try {
      setTeams(await listTeamsnapTeams());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load teams.");
    } finally {
      setLoading(false);
    }
  }

  if (!connected) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Connect your TeamSnap account to add a team&apos;s schedule.
        </p>
        <Button
          render={<a href="/api/teamsnap/authorize" />}
          nativeButton={false}
          size="sm"
          variant="outline"
        >
          <Link2 />
          Connect TeamSnap
        </Button>
      </div>
    );
  }

  if (selected) {
    return (
      <TeamsnapPlayerPicker
        member={member}
        team={selected}
        onBack={() => setSelected(null)}
        onDone={onDone}
      />
    );
  }

  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" onClick={loadTeams} disabled={loading}>
        {loading ? "Loading…" : teams ? "Refresh teams" : "Show my teams"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {teams?.length === 0 && (
        <p className="text-sm text-muted-foreground">No active teams found.</p>
      )}
      {teams && teams.length > 0 && (
        <ul className="space-y-1.5">
          {teams.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
              <Button
                size="icon-sm"
                onClick={() => setSelected(t)}
                aria-label="Choose team"
              >
                <Plus />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {/* Re-running the OAuth flow refreshes the stored token in place (the
          callback upserts on member_email) without touching the teams or player
          links already set up — needed to upgrade an old read-only token so
          RSVPs can be written back. */}
      <p className="border-t border-border pt-2 text-xs text-muted-foreground">
        RSVP not saving?{" "}
        <a
          href="/api/teamsnap/authorize"
          className="font-medium text-foreground hover:underline"
        >
          Reconnect TeamSnap
        </a>{" "}
        — your teams and player links stay as they are.
      </p>
    </div>
  );
}

function TeamsnapPlayerPicker({
  member,
  team,
  onBack,
  onDone,
}: {
  member: CalendarMember;
  team: { id: number; name: string };
  onBack: () => void;
  onDone: () => void;
}) {
  const memberName = member.name ?? member.email;
  const [players, setPlayers] = useState<{ id: number; name: string }[] | null>(
    null,
  );
  const [playerId, setPlayerId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listTeamsnapPlayers(team.id)
      .then((p) => {
        if (!active) return;
        setPlayers(p);
        const first = memberName.split(" ")[0].toLowerCase();
        const match = p.find((x) => x.name.toLowerCase().startsWith(first));
        if (match) setPlayerId(String(match.id));
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Couldn't load the roster.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [team.id, memberName]);

  async function add() {
    setPending(true);
    setError(null);
    try {
      await addTeamsnapSource({
        teamId: team.id,
        teamName: team.name,
        memberEmail: member.email,
        playerMemberId: playerId ? Number(playerId) : null,
        color: member.color,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the team.");
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{team.name}</div>
      <div className="space-y-1.5">
        <Label htmlFor={`ts-player-${team.id}`}>Which player is {memberName}?</Label>
        <select
          id={`ts-player-${team.id}`}
          value={playerId}
          onChange={(e) => setPlayerId(e.target.value)}
          disabled={loading || pending}
          className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">
            {loading ? "Loading roster…" : "Not on the roster"}
          </option>
          {players?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Links the schedule to {memberName}&apos;s RSVP. Leave unset to just
          import the games.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={onBack} disabled={pending}>
          Back
        </Button>
        <Button size="sm" onClick={add} disabled={loading || pending}>
          <Plus />
          Add team
        </Button>
      </div>
    </div>
  );
}

