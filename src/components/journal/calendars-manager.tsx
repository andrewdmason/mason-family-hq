"use client";

import { useEffect, useState, useTransition } from "react";
import { Link2, Pencil, Plus, Rss, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  CalendarMember,
  CalendarSource,
  CalendarSourceType,
} from "@/lib/calendar/types";
import {
  addIcsSource,
  addTeamsnapSource,
  addGoogleSource,
  deleteSource,
  renameSource,
  ensureFeedToken,
  listTeamsnapTeams,
  listTeamsnapPlayers,
  relinkTeamsnapPlayer,
  listGoogleCalendarsForConnection,
} from "@/app/(calendar)/calendar/actions";

const SOURCE_TYPE_LABELS: Record<CalendarSourceType, string> = {
  google: "Google",
  teamsnap: "TeamSnap",
  ics: "ICS",
  manual: "Manual",
};

// One group per family member, plus a trailing "Family (everyone)" group whose
// key is null (member_email IS NULL). Each group lets an owner/parent see and
// manage the calendars that belong to that person.
type Group = {
  key: string | null;
  name: string;
  color: string | null;
};

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
  const groups: Group[] = [
    ...members.map((m) => ({
      key: m.email,
      name: m.name ?? m.email,
      color: m.color,
    })),
    { key: null, name: "Family (everyone)", color: "#64748b" },
  ];

  return (
    <div className="mt-6 space-y-4">
      {groups.map((g) => (
        <CalendarGroup
          key={g.key ?? "__family__"}
          group={g}
          sources={sources.filter((s) => s.member_email === g.key)}
          teamsnapConnected={teamsnapConnected}
          googleConnectedEmails={googleConnectedEmails}
          currentUserEmail={currentUserEmail}
        />
      ))}
    </div>
  );
}

function CalendarGroup({
  group,
  sources,
  teamsnapConnected,
  googleConnectedEmails,
  currentUserEmail,
}: {
  group: Group;
  sources: CalendarSource[];
  teamsnapConnected: boolean;
  googleConnectedEmails: string[];
  currentUserEmail: string;
}) {
  const isFamily = group.key === null;
  const [adding, setAdding] = useState(false);

  return (
    <section className="rounded-lg border border-border">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: group.color ?? "#64748b" }}
            aria-hidden
          />
          <h3 className="font-serif text-sm font-medium text-foreground">
            {group.name}
          </h3>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
        >
          <Plus />
          Add calendar
        </Button>
      </header>

      <div className="space-y-3 px-4 pb-4">
        <SourceList sources={sources} />

        {adding && (
          <AddCalendarForm
            group={group}
            teamsnapConnected={teamsnapConnected}
            googleConnectedEmails={googleConnectedEmails}
            currentUserEmail={currentUserEmail}
            onDone={() => setAdding(false)}
          />
        )}

        {!isFamily && (
          <FeedLink memberEmail={group.key as string} name={group.name} />
        )}
      </div>
    </section>
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
    return (
      <p className="text-sm text-muted-foreground">No calendars yet.</p>
    );
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

/** One calendar in a group's list. The display name is editable inline — clicking
 * the pencil swaps the name for an input so a parent can rename the calendar
 * (e.g. a cryptic TeamSnap team name into something readable). */
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
            <Button
              size="sm"
              variant="ghost"
              onClick={cancel}
              disabled={pending}
            >
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

/** Shows whether a TeamSnap source is linked to a roster player (needed for RSVP
 * and attendance) and lets a parent set or change it inline. */
function TeamsnapPlayerLink({ source }: { source: CalendarSource }) {
  const [editing, setEditing] = useState(false);
  const [players, setPlayers] = useState<
    { id: number; name: string }[] | null
  >(null);
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

type AddTab = "google" | "ics" | "teamsnap";

const TAB_LABELS: Record<AddTab, string> = {
  google: "Google",
  ics: "ICS link",
  teamsnap: "TeamSnap",
};

function AddCalendarForm({
  group,
  teamsnapConnected,
  googleConnectedEmails,
  currentUserEmail,
  onDone,
}: {
  group: Group;
  teamsnapConnected: boolean;
  googleConnectedEmails: string[];
  currentUserEmail: string;
  onDone: () => void;
}) {
  const isFamily = group.key === null;
  // TeamSnap teams are assigned to a specific person, so the option only shows
  // for member groups — never the family-wide group.
  const showTeamsnap = !isFamily;
  // Google calendars come from a person's own account: a member group uses that
  // member's connection; the family group uses the signed-in parent's, to add a
  // shared calendar family-wide.
  const connectionEmail = isFamily ? currentUserEmail : (group.key as string);
  const tabs: AddTab[] = ["google", "ics", ...(showTeamsnap ? ["teamsnap" as const] : [])];
  const [tab, setTab] = useState<AddTab>("google");

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

      {tab === "google" && (
        <GoogleForm
          group={group}
          connectionEmail={connectionEmail}
          connected={googleConnectedEmails.includes(connectionEmail)}
          onDone={onDone}
        />
      )}
      {tab === "ics" && <IcsForm group={group} onDone={onDone} />}
      {tab === "teamsnap" && (
        <TeamsnapForm
          group={group}
          connected={teamsnapConnected}
          onDone={onDone}
        />
      )}
    </div>
  );
}

function GoogleForm({
  group,
  connectionEmail,
  connected,
  onDone,
}: {
  group: Group;
  connectionEmail: string;
  connected: boolean;
  onDone: () => void;
}) {
  const isFamily = group.key === null;
  const [calendars, setCalendars] = useState<
    { id: string; summary: string; backgroundColor: string | null }[] | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadCalendars() {
    setLoading(true);
    setError(null);
    try {
      const list = await listGoogleCalendarsForConnection(connectionEmail);
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

  async function add(cal: {
    id: string;
    summary: string;
    backgroundColor: string | null;
  }) {
    setPendingId(cal.id);
    setError(null);
    try {
      await addGoogleSource({
        memberEmail: group.key,
        connectionEmail,
        googleCalendarId: cal.id,
        nickname: cal.summary,
        color: cal.backgroundColor ?? group.color,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the calendar.");
      setPendingId(null);
    }
  }

  if (!connected) {
    return (
      <p className="text-sm text-muted-foreground">
        {isFamily
          ? "Sign in with Google to add a shared calendar from your account."
          : `${group.name} needs to sign in with Google to connect their calendar.`}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="outline"
        onClick={loadCalendars}
        disabled={loading}
      >
        {loading ? "Loading…" : calendars ? "Refresh calendars" : "Show calendars"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {calendars?.length === 0 && (
        <p className="text-sm text-muted-foreground">No calendars found.</p>
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
              <span className="min-w-0 flex-1 truncate text-sm">{c.summary}</span>
              <Button
                size="icon-sm"
                onClick={() => add(c)}
                disabled={pendingId !== null}
                aria-label="Add calendar"
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

function IcsForm({ group, onDone }: { group: Group; onDone: () => void }) {
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
        memberEmail: group.key,
        nickname,
        icsUrl: url,
        color: group.color,
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
        <Label htmlFor={`ics-name-${group.key ?? "family"}`}>Name</Label>
        <Input
          id={`ics-name-${group.key ?? "family"}`}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="School calendar"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`ics-url-${group.key ?? "family"}`}>ICS URL</Label>
        <Input
          id={`ics-url-${group.key ?? "family"}`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/calendar.ics"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button size="sm" onClick={onAdd} disabled={pending}>
        <Rss />
        Add calendar
      </Button>
    </div>
  );
}

function TeamsnapForm({
  group,
  connected,
  onDone,
}: {
  group: Group;
  connected: boolean;
  onDone: () => void;
}) {
  const [teams, setTeams] = useState<{ id: number; name: string }[] | null>(
    null,
  );
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

  // Once a team is picked, choose which player on its roster this calendar
  // belongs to — that linkage is what powers RSVP and attendance.
  if (selected) {
    return (
      <TeamsnapPlayerPicker
        group={group}
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
    </div>
  );
}

function TeamsnapPlayerPicker({
  group,
  team,
  onBack,
  onDone,
}: {
  group: Group;
  team: { id: number; name: string };
  onBack: () => void;
  onDone: () => void;
}) {
  const [players, setPlayers] = useState<
    { id: number; name: string }[] | null
  >(null);
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
        // Auto-select the player whose first name matches this member.
        const first = group.name.split(" ")[0].toLowerCase();
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
  }, [team.id, group.name]);

  async function add() {
    setPending(true);
    setError(null);
    try {
      await addTeamsnapSource({
        teamId: team.id,
        teamName: team.name,
        memberEmail: group.key,
        playerMemberId: playerId ? Number(playerId) : null,
        color: group.color,
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
        <Label htmlFor={`ts-player-${team.id}`}>Which player is {group.name}?</Label>
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
          Links the schedule to {group.name}&apos;s RSVP. Leave unset to just
          subscribe to the games.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={onBack}
          disabled={pending}
        >
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

function FeedLink({
  memberEmail,
  name,
}: {
  memberEmail: string;
  name: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  async function reveal() {
    const token = await ensureFeedToken(memberEmail);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    setUrl(`${origin}/api/feeds/${token}/calendar.ics`);
  }

  return (
    <div className="space-y-1 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Subscribe to {name}&apos;s calendar from your phone (Apple or Google
          Calendar).
        </span>
        <Button size="sm" variant="outline" onClick={reveal}>
          Get link
        </Button>
      </div>
      {url && <Input readOnly value={url} className="text-xs" />}
    </div>
  );
}
