"use client";

import { useMemo, useState } from "react";
import {
  addInlineComment,
  deleteInlineComment,
  editInlineComment,
} from "@/app/(journal)/journal/actions";
import type { EntryBlock } from "@/lib/journal/entry-blocks";
import type { JournalInlineCommentWithAuthor } from "@/lib/types";
import { InlineCommentThread } from "@/components/journal/inline-comment-thread";
import { PostBody } from "@/components/journal/post-body";

/**
 * Renders a finished, shared post's body as a sequence of blocks, each followed
 * by its inline comment thread and a hover-reveal "add a comment" target. Owns
 * the comment state for optimistic add/edit/delete; the poster sees their own
 * comment immediately, others on reload (revalidatePath in the actions).
 *
 * For standard and freeform entries this renders the body itself
 * (`renderBlockContent`). For quote and recap entries the body is already shown
 * by QuoteEntryView / RecapEntryView, so this renders only the comment layer
 * anchored to the single block.
 */
export function CommentableEntry({
  entryId,
  blocks,
  initialComments,
  currentUserId,
  isOwner,
  renderBlockContent = true,
}: {
  entryId: string;
  blocks: EntryBlock[];
  initialComments: JournalInlineCommentWithAuthor[];
  currentUserId: string;
  isOwner: boolean;
  renderBlockContent?: boolean;
}) {
  const [comments, setComments] =
    useState<JournalInlineCommentWithAuthor[]>(initialComments);
  const [error, setError] = useState<string | null>(null);

  // Group comments under their block. A comment whose anchor drifted past the
  // current block count (the author edited the post after it was commented on)
  // is clamped to the last block rather than dropped.
  const commentsByBlock = useMemo(() => {
    const lastIndex = Math.max(0, blocks.length - 1);
    const map = new Map<number, JournalInlineCommentWithAuthor[]>();
    for (const comment of comments) {
      const idx = Math.min(comment.block_index, lastIndex);
      const list = map.get(idx) ?? [];
      list.push(comment);
      map.set(idx, list);
    }
    return map;
  }, [comments, blocks.length]);

  async function handleAdd(blockIndex: number, text: string) {
    setError(null);
    const created = await addInlineComment(entryId, blockIndex, text);
    setComments((prev) => [...prev, created]);
  }

  async function handleEdit(commentId: string, text: string) {
    setError(null);
    const previous = comments;
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, content: text } : c))
    );
    try {
      await editInlineComment(commentId, text);
    } catch (err) {
      setComments(previous);
      throw err;
    }
  }

  async function handleDelete(commentId: string) {
    setError(null);
    const previous = comments;
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    try {
      await deleteInlineComment(commentId);
    } catch (err) {
      setComments(previous);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-6">
      {blocks.map((block) => (
        <div key={block.index}>
          {renderBlockContent && <BlockContent block={block} />}
          <InlineCommentThread
            comments={commentsByBlock.get(block.index) ?? []}
            currentUserId={currentUserId}
            isOwner={isOwner}
            onAdd={(text) => handleAdd(block.index, text)}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </div>
      ))}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}

/** Render a body block in the same voice the read view uses for it. */
function BlockContent({ block }: { block: EntryBlock }) {
  if (block.kind === "assistant") {
    return (
      <div className="italic text-muted-foreground pl-6 border-l-2 border-muted font-serif text-lg leading-relaxed">
        <PostBody content={block.content} />
      </div>
    );
  }
  // user / freeform — a person's own words.
  return (
    <PostBody
      content={block.content}
      className="font-serif text-lg leading-relaxed text-foreground"
    />
  );
}
