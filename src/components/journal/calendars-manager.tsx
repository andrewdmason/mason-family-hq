"use client";

import { useState, useTransition } from "react";
import { Link2, Plus, Rss, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CalendarMember, CalendarSource } from "@/lib/calendar/types";
import {
  addIcsSource,
  addTeamsnapSource,
  deleteSource,
  ensureFeedToken,
  listTeamsnapTeams,
} from "@/app/(calendar)/calendar/actions";

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
}: {
  members: CalendarMember[];
  sources: CalendarSource[];
  teamsnapConnected: boolean;
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
        />
      ))}
    </div>
  );
}

function CalendarGroup({
  group,
  sources,
  teamsnapConnected,
}: {
  group: Group;
  sources: CalendarSource[];
  teamsnapConnected: boolean;
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
          <li
            key={s.id}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: s.color ?? "#64748b" }}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {s.nickname ?? s.teamsnap_team_name ?? "Calendar"}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {s.source_type === "teamsnap" ? "TeamSnap" : "ICS"}
                {s.sync_error ? ` · error: ${s.sync_error}` : ""}
              </span>
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => handleDelete(s.id)}
              disabled={pending}
              aria-label="Remove calendar"
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </>
  );
}

function AddCalendarForm({
  group,
  teamsnapConnected,
  onDone,
}: {
  group: Group;
  teamsnapConnected: boolean;
  onDone: () => void;
}) {
  const isFamily = group.key === null;
  // TeamSnap teams are assigned to a specific person, so the option only shows
  // for member groups — never the family-wide group.
  const showTeamsnap = !isFamily;
  const [tab, setTab] = useState<"ics" | "teamsnap">("ics");

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
      {showTeamsnap && (
        <div className="inline-flex rounded-lg border p-0.5 text-xs">
          {(["ics", "teamsnap"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                "rounded-md px-2.5 py-1 font-medium capitalize transition-colors " +
                (tab === t
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {t === "ics" ? "ICS link" : "TeamSnap"}
            </button>
          ))}
        </div>
      )}

      {tab === "ics" || !showTeamsnap ? (
        <IcsForm group={group} onDone={onDone} />
      ) : (
        <TeamsnapForm
          group={group}
          connected={teamsnapConnected}
          onDone={onDone}
        />
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

  async function add(team: { id: number; name: string }) {
    setError(null);
    try {
      await addTeamsnapSource({
        teamId: team.id,
        teamName: team.name,
        memberEmail: group.key,
        color: group.color,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the team.");
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
          size="sm"
          variant="outline"
        >
          <Link2 />
          Connect TeamSnap
        </Button>
      </div>
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
              <Button size="icon-sm" onClick={() => add(t)} aria-label="Add team">
                <Plus />
              </Button>
            </li>
          ))}
        </ul>
      )}
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
