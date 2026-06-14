"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import {
  createReadingApiToken,
  revokeReadingApiToken,
} from "@/app/(reading)/reader/actions";

export type ReadingApiTokenRow = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
};

/**
 * Personal API tokens for /api/reading/ingest (the Chrome article-capture
 * extension). The raw token is displayed exactly once, right after minting —
 * copy it then; only its hash is stored.
 */
export function ReadingApiTokens({ tokens }: { tokens: ReadingApiTokenRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [minted, setMinted] = useState<{ name: string; token: string } | null>(
    null
  );
  const [copied, setCopied] = useState(false);

  const mint = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const { token } = await createReadingApiToken(trimmed);
      setMinted({ name: trimmed, token });
      setCopied(false);
      setName("");
      router.refresh();
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    if (!minted) return;
    await navigator.clipboard.writeText(minted.token);
    setCopied(true);
  };

  return (
    <div className="space-y-4">
      {minted && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-medium text-foreground">
            “{minted.name}” created — copy the token now. It won’t be shown
            again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-background px-2 py-1.5 text-xs ring-1 ring-border">
              {minted.token}
            </code>
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {copied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        {tokens.length === 0 ? (
          <div className="p-8 text-center">
            <KeyRound className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              No tokens yet. Create one for the Chrome extension.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Name
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Created
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Last used
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.id} className="border-t border-border/60">
                  <td className="px-3 py-2.5 font-medium text-foreground">
                    {token.name}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {dateLabel(token.createdAt)}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {token.lastUsedAt ? dateLabel(token.lastUsedAt) : "Never"}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        revokeReadingApiToken(token.id).finally(() =>
                          router.refresh()
                        )
                      }
                      aria-label={`Revoke ${token.name}`}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void mint();
          }}
          placeholder="Token name (e.g. Chrome — MacBook)"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40"
        />
        <button
          type="button"
          onClick={() => void mint()}
          disabled={creating || !name.trim()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus className="size-4" />
          Create token
        </button>
      </div>
    </div>
  );
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
