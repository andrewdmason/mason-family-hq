"use client";

import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MemberRole } from "@/lib/types";

type ViewableMember = {
  email: string;
  name: string | null;
  role: MemberRole;
};

/**
 * Adult-only "view as" control for Mason Bucks: pick a kid to see and manage
 * their wallet. Navigates via the ?member= query param; selecting the owner
 * returns to their own wallet. Mirrors the reader's MemberViewSwitcher.
 */
export function BucksMemberSwitcher({
  members,
  ownerEmail,
  currentEmail,
}: {
  members: ViewableMember[];
  ownerEmail: string;
  currentEmail: string;
}) {
  const router = useRouter();

  function handleChange(email: string | null) {
    if (!email || email === ownerEmail) {
      router.push("/bucks");
    } else {
      router.push(`/bucks?member=${encodeURIComponent(email)}`);
    }
  }

  function labelFor(email: string): string {
    const m = members.find((x) => x.email === email);
    if (!m) return email;
    if (m.role === "owner") return `${m.name ?? "Me"} (me)`;
    return m.name ?? m.email;
  }

  return (
    <Select value={currentEmail} onValueChange={handleChange}>
      <SelectTrigger size="sm" aria-label="View another member's wallet">
        <Eye className="text-muted-foreground" />
        <SelectValue>{labelFor(currentEmail)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {members.map((m) => (
          <SelectItem key={m.email} value={m.email}>
            {m.role === "owner" ? `${m.name ?? "Me"} (me)` : m.name ?? m.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
