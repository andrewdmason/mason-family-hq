"use client";

import { useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { TodoTaskImage } from "@/lib/todos/queries";
import { cn } from "@/lib/utils";

export type UploadingImage = { key: string; objectUrl: string };

/**
 * The images strip in a task's detail: thumbnails (tap for a lightbox),
 * uploading placeholders, hover-delete, and an add button. Paste and
 * drag-drop are handled by the surrounding detail/row — this is just the
 * rendering and the explicit picker.
 */
export function TaskImages({
  images,
  uploading,
  onAddFiles,
  onDelete,
}: {
  images: TodoTaskImage[];
  uploading: UploadingImage[];
  onAddFiles: (files: File[]) => void;
  onDelete: (image: TodoTaskImage) => void;
}) {
  const [lightbox, setLightbox] = useState<TodoTaskImage | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {images.map((image) => (
        <div key={image.id} className="group/image relative">
          <button
            type="button"
            onClick={() => setLightbox(image)}
            className="block overflow-hidden rounded-lg border border-border"
            aria-label="View image"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.displayUrl}
              alt=""
              className="h-20 w-20 object-cover"
            />
          </button>
          <button
            type="button"
            onClick={() => onDelete(image)}
            aria-label="Remove image"
            className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-foreground/80 text-background shadow group-hover/image:flex"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}

      {uploading.map((item) => (
        <div
          key={item.key}
          className="relative h-20 w-20 overflow-hidden rounded-lg border border-border"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.objectUrl}
            alt=""
            className="h-full w-full object-cover opacity-50"
          />
          <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-foreground" />
        </div>
      ))}

      <label
        className={cn(
          "flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
          images.length === 0 && uploading.length === 0 && "h-9 w-auto flex-row px-2.5"
        )}
      >
        <ImagePlus className="size-4" />
        {images.length === 0 && uploading.length === 0 && (
          <span className="text-xs">Add images</span>
        )}
        <input
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onAddFiles(files);
            e.target.value = "";
          }}
        />
      </label>

      <Dialog open={!!lightbox} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent
          className="max-w-3xl border-none bg-transparent p-0 shadow-none ring-0 sm:max-w-3xl"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Image</DialogTitle>
          {lightbox && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox.displayUrl}
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
