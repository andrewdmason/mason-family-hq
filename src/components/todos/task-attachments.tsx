"use client";

import { useState } from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { TodoTaskAttachment } from "@/lib/todos/queries";
import { cn } from "@/lib/utils";

export type UploadingAttachment = {
  key: string;
  name: string;
  /** Local preview for images; null for plain files. */
  objectUrl: string | null;
};

/**
 * The attachments strip in a task's detail: image thumbnails (tap for a
 * lightbox) plus named chips for other files (tap to open), uploading
 * placeholders, hover-delete, and an add button. Paste and drag-drop are
 * handled by the surrounding detail/row — this is the rendering and the
 * explicit picker.
 *
 * `readOnly` keeps the thumbnails, chips and lightbox but drops both ways to
 * change the set: focus mode shows a task, it doesn't edit one.
 */
export function TaskAttachments({
  attachments,
  uploading,
  onAddFiles,
  onDelete,
  readOnly = false,
}: {
  attachments: TodoTaskAttachment[];
  uploading: UploadingAttachment[];
  onAddFiles: (files: File[]) => void;
  onDelete: (attachment: TodoTaskAttachment) => void;
  readOnly?: boolean;
}) {
  const [lightbox, setLightbox] = useState<TodoTaskAttachment | null>(null);
  const images = attachments.filter((a) => a.kind === "image");
  const files = attachments.filter((a) => a.kind === "file");
  const empty = attachments.length === 0 && uploading.length === 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {images.map((image) => (
          <div key={image.id} className="group/attachment relative">
            <button
              type="button"
              onClick={() => setLightbox(image)}
              className="block overflow-hidden rounded-lg border border-border"
              aria-label="View image"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt="" className="h-20 w-20 object-cover" />
            </button>
            {!readOnly && <RemoveBadge onClick={() => onDelete(image)} />}
          </div>
        ))}

        {uploading
          .filter((u) => u.objectUrl)
          .map((item) => (
            <div
              key={item.key}
              className="relative h-20 w-20 overflow-hidden rounded-lg border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.objectUrl!}
                alt=""
                className="h-full w-full object-cover opacity-50"
              />
              <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-foreground" />
            </div>
          ))}

        <label
          className={cn(
            "flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
            empty ? "h-9 px-2.5" : "h-20 w-20 flex-col",
            readOnly && "hidden"
          )}
        >
          <Paperclip className="size-4" />
          {empty && <span className="text-xs">Attach files</span>}
          <input
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length > 0) onAddFiles(picked);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {(files.length > 0 || uploading.some((u) => !u.objectUrl)) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {files.map((file) => (
            <span key={file.id} className="group/attachment relative inline-flex">
              <a
                href={file.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-56 items-center gap-1.5 rounded-full border border-border bg-card py-1 pr-2.5 pl-2 text-xs text-foreground hover:border-primary/40"
              >
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{file.fileName ?? "Attachment"}</span>
              </a>
              {!readOnly && <RemoveBadge onClick={() => onDelete(file)} />}
            </span>
          ))}
          {uploading
            .filter((u) => !u.objectUrl)
            .map((item) => (
              <span
                key={item.key}
                className="inline-flex max-w-56 items-center gap-1.5 rounded-full border border-border bg-card py-1 pr-2.5 pl-2 text-xs text-muted-foreground"
              >
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                <span className="truncate">{item.name}</span>
              </span>
            ))}
        </div>
      )}

      <Dialog open={!!lightbox} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent
          className="max-w-3xl border-none bg-transparent p-0 shadow-none ring-0 sm:max-w-3xl"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Image</DialogTitle>
          {lightbox && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox.url}
              alt=""
              className="max-h-[85vh] w-full rounded-xl object-contain"
              onClick={() => setLightbox(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RemoveBadge({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove attachment"
      className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-foreground/80 text-background shadow group-hover/attachment:flex"
    >
      <X className="size-3" />
    </button>
  );
}
