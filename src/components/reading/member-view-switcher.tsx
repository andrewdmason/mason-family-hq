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

type ViewableMember = {
  email: string;
  name: string | null;
  is_owner: boolean;
};

/**
 * Owner-only "view as" control: pick a family member to see and manage their
 * reading. Navigates via the ?member= query param (so views are linkable);
 * selecting the owner returns to their own books.
 */
export function MemberViewSwitcher({
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
      router.push("/reading");
    } else {
      router.push(`/reading?member=${encodeURIComponent(email)}`);
    }
  }

  function labelFor(email: string): string {
    const m = members.find((x) => x.email === email);
    if (!m) return email;
    if (m.is_owner) return `${m.name ?? "Me"} (me)`;
    return m.name ?? m.email;
  }

  return (
    <Select value={currentEmail} onValueChange={handleChange}>
      <SelectTrigger size="sm" aria-label="View another member's reading">
        <Eye className="text-muted-foreground" />
        <SelectValue>{labelFor(currentEmail)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {members.map((m) => (
          <SelectItem key={m.email} value={m.email}>
            {m.is_owner ? `${m.name ?? "Me"} (me)` : m.name ?? m.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
