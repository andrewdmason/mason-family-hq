"use client";

import { useState } from "react";
import { Link2, Plus, Rss, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { CalendarMember, CalendarSource } from "@/lib/calendar/types";
import {
  addIcsSource,
  deleteSource,
  listTeamsnapTeams,
  addTeamsnapSource,
  ensureFeedToken,
} from "@/app/(calendar)/calendar/actions";

const memberSelectClass =
  "flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function SourcesSheet({
  open,
  onOpenChange,
  sources,
  members,
  teamsnapConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: CalendarSource[];
  members: CalendarMember[];
  teamsnapConnected: boolean;
}) {
  const memberName = (email: string | null) =>
    email
      ? (members.find((m) => m.email === email)?.name ?? email)
      : "Family";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Calendars</SheetTitle>
          <SheetDescription>
            Connect TeamSnap teams and subscribe to ICS calendars. Events sync
            automatically.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-8">
          <section>
            <h3 className="mb-2 text-sm font-medium">Connected calendars</h3>
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No calendars yet. Add one below.
              </p>
            ) : (
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
                        {s.source_type === "teamsnap" ? "TeamSnap" : "ICS"} ·{" "}
                        {memberName(s.member_email)}
                        {s.sync_error ? ` · error: ${s.sync_error}` : ""}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => deleteSource(s.id)}
                      aria-label="Remove calendar"
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Separator />

          <TeamsnapSection
            members={members}
            connected={teamsnapConnected}
          />

          <Separator />

          <IcsSection members={members} />

          <Separator />

          <FeedSection members={members} memberName={memberName} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TeamsnapSection({
  members,
  connected,
}: {
  members: CalendarMember[];
  connected: boolean;
}) {
  const kids = members.filter((m) => m.role === "kid");
  const [teams, setTeams] = useState<{ id: number; name: string }[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assign, setAssign] = useState<Record<number, string>>({});

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

  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">TeamSnap</h3>
      {!connected ? (
        <Button
          render={<a href="/api/teamsnap/authorize" />}
          size="sm"
          variant="outline"
        >
          <Link2 />
          Connect TeamSnap
        </Button>
      ) : (
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
                  <select
                    value={assign[t.id] ?? ""}
                    onChange={(e) =>
                      setAssign((a) => ({ ...a, [t.id]: e.target.value }))
                    }
                    className={`${memberSelectClass} w-32`}
                  >
                    <option value="">Kid…</option>
                    {kids.map((k) => (
                      <option key={k.email} value={k.email}>
                        {k.name ?? k.email}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="icon-sm"
                    onClick={() =>
                      addTeamsnapSource({
                        teamId: t.id,
                        teamName: t.name,
                        memberEmail: assign[t.id] || null,
                        color: assign[t.id]
                          ? (members.find((m) => m.email === assign[t.id])
                              ?.color ?? null)
                          : null,
                      })
                    }
                    aria-label="Add team"
                  >
                    <Plus />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function IcsSection({ members }: { members: CalendarMember[] }) {
  const [memberEmail, setMemberEmail] = useState("");
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
        memberEmail: memberEmail || null,
        nickname,
        icsUrl: url,
        color: memberEmail
          ? (members.find((m) => m.email === memberEmail)?.color ?? null)
          : null,
      });
      setNickname("");
      setUrl("");
      setMemberEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the calendar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Subscribe to an ICS calendar</h3>
      <div className="space-y-1.5">
        <Label htmlFor="ics-name">Name</Label>
        <Input
          id="ics-name"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="School calendar"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ics-url">ICS URL</Label>
        <Input
          id="ics-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/calendar.ics"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ics-member">Whose calendar</Label>
        <select
          id="ics-member"
          value={memberEmail}
          onChange={(e) => setMemberEmail(e.target.value)}
          className={memberSelectClass}
        >
          <option value="">Family (everyone)</option>
          {members.map((m) => (
            <option key={m.email} value={m.email}>
              {m.name ?? m.email}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button size="sm" onClick={onAdd} disabled={pending}>
        <Rss />
        Add calendar
      </Button>
    </section>
  );
}

function FeedSection({
  members,
  memberName,
}: {
  members: CalendarMember[];
  memberName: (email: string | null) => string;
}) {
  const kids = members.filter((m) => m.role === "kid");
  const [urls, setUrls] = useState<Record<string, string>>({});

  async function reveal(email: string) {
    const token = await ensureFeedToken(email);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    setUrls((u) => ({
      ...u,
      [email]: `${origin}/api/feeds/${token}/calendar.ics`,
    }));
  }

  if (kids.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Subscribe from your phone</h3>
      <p className="text-xs text-muted-foreground">
        Add a kid&apos;s calendar to Apple or Google Calendar.
      </p>
      <ul className="space-y-2">
        {kids.map((k) => (
          <li key={k.email} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">{memberName(k.email)}</span>
              <Button size="sm" variant="outline" onClick={() => reveal(k.email)}>
                Get link
              </Button>
            </div>
            {urls[k.email] && (
              <Input readOnly value={urls[k.email]} className="text-xs" />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
