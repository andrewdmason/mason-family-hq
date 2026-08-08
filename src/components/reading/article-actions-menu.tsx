"use client";

import { useState, useTransition } from "react";
import {
  Archive,
  BookMarked,
  BookOpen,
  Check,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  PauseCircle,
  Trash2,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { removeBook, updateBook } from "@/app/(reading)/reader/actions";
import { READING_STATUSES } from "@/lib/reading/status";
import { cn } from "@/lib/utils";
import type { ReadingBookStatus, ReadingBookWithProgress } from "@/lib/types";

const STATUS_ICONS: Record<ReadingBookStatus, typeof BookOpen> = {
  in_progress: BookOpen,
  queued: BookMarked,
  archive: Archive,
  paused: PauseCircle,
};

/**
 * What you can do to a saved article. Short, because an article has no file to
 * attach, no edition to buy and no page count to correct — the reasons the book
 * menu is as long as it is. Same two ways in as a book's: the "…" button and a
 * right-click on the article itself.
 */
export function useArticleMenu({
  article,
  memberEmail = null,
  onError,
}: {
  article: ReadingBookWithProgress;
  memberEmail?: string | null;
  onError: (message: string | null) => void;
}) {
  const [busy, startTransition] = useTransition();

  function setStatus(status: ReadingBookStatus) {
    if (status === article.status) return;
    onError(null);
    startTransition(async () => {
      try {
        await updateBook(article.id, { status, memberEmail });
      } catch (err) {
        onError(err instanceof Error ? err.message : "Couldn't update.");
      }
    });
  }

  function handleDelete() {
    if (!window.confirm(`Delete "${article.title}" from your reading?`)) return;
    onError(null);
    startTransition(async () => {
      try {
        await removeBook(article.id, memberEmail);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Couldn't delete.");
      }
    });
  }

  const items = (
    <>
      {article.source_url && (
        <DropdownMenuItem
          render={
            <a
              href={article.source_url}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          <ExternalLink />
          Open original
        </DropdownMenuItem>
      )}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          {(() => {
            const Icon = STATUS_ICONS[article.status];
            return <Icon />;
          })()}
          Status
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-40">
          {READING_STATUSES.map((option) => {
            const Icon = STATUS_ICONS[option.value];
            const current = option.value === article.status;
            return (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setStatus(option.value)}
                disabled={busy || current}
              >
                <Icon />
                {option.label}
                {current && <Check className="ml-auto opacity-60" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={handleDelete}>
        <Trash2 />
        Delete
      </DropdownMenuItem>
    </>
  );

  return { items, pending: busy, label: article.title };
}

export type ArticleMenu = ReturnType<typeof useArticleMenu>;

export function ArticleActionsMenu({
  menu,
  className,
  align = "end",
}: {
  menu: ArticleMenu;
  className?: string;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(className, (open || menu.pending) && "opacity-100")}
        aria-label={`Actions for ${menu.label}`}
        disabled={menu.pending}
      >
        {menu.pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MoreHorizontal className="h-4 w-4" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side="bottom" className="w-48">
        {menu.items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ArticleContextMenu({
  menu,
  className,
  children,
}: {
  menu: ArticleMenu;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger className={className}>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">{menu.items}</ContextMenuContent>
    </ContextMenu>
  );
}
