"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MemberRole } from "@/lib/types";

type Member = { email: string; name: string | null; role: MemberRole };

/**
 * Dev-only sign-in helper: pick an existing family member from the dropdown, or
 * type any email to provision a fresh one, and dev-login as them — no URL
 * editing. Renders nothing in production.
 */
export function DevLoginSwitcher() {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");

  useEffect(() => {
    fetch("/auth/dev-members")
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d: { members?: Member[] }) => {
        const list = d.members ?? [];
        setMembers(list);
        if (list[0]) setEmail(list[0].email);
      })
      .catch(() => {});
  }, []);

  function devLogin() {
    const target = email.trim();
    window.location.href = target
      ? `/auth/dev-login?email=${encodeURIComponent(target)}`
      : "/auth/dev-login";
  }

  return (
    <>
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">dev</span>
        </div>
      </div>

      <div className="space-y-2">
        {members.length > 0 && (
          <select
            value={members.some((m) => m.email === email) ? email : ""}
            onChange={(e) => setEmail(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
          >
            {members.map((m) => (
              <option key={m.email} value={m.email}>
                {(m.name ? `${m.name} — ${m.email}` : m.email) +
                  ` (${m.role})`}
              </option>
            ))}
            <option value="">Custom email…</option>
          </select>
        )}
        <Input
          type="email"
          placeholder="or type an email to provision"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button variant="outline" className="w-full" onClick={devLogin}>
          Dev login
        </Button>
      </div>
    </>
  );
}
