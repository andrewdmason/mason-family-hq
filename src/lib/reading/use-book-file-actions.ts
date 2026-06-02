"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertBook, uploadBookFile } from "@/lib/reading/book-upload";
import type { ReadingBookWithProgress } from "@/lib/types";

/**
 * Shared upload/convert/read state for a book, used by both the list card and the
 * archive tile so the file affordances (upload, replace, processing, retry, and
 * "is this readable?") behave identically wherever a book is shown.
 */
export function useBookFileActions(
  book: ReadingBookWithProgress,
  memberEmail: string | null
) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [retrying, startRetry] = useTransition();

  const content = book.content;
  const hasFile = !!content;
  const isReady = content?.status === "ready";
  const isProcessing =
    content?.status === "processing" || content?.status === "uploaded";
  const isFailed = content?.status === "failed";

  // While a file is converting, refresh periodically so the UI advances to the
  // ready/failed state without a manual reload.
  useEffect(() => {
    if (!isProcessing) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [isProcessing, router]);

  async function handleFile(file: File | undefined) {
    if (!file || busy) return;
    setUploadError(null);
    setBusy(true);
    try {
      await uploadBookFile(book.id, file, memberEmail);
      router.refresh();
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Couldn't upload that file."
      );
    } finally {
      setBusy(false);
    }
  }

  function retryConvert() {
    setUploadError(null);
    startRetry(async () => {
      try {
        await convertBook(book.id, memberEmail);
        router.refresh();
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Couldn't process this book."
        );
      }
    });
  }

  function openFilePicker() {
    inputRef.current?.click();
  }

  return {
    inputRef,
    openFilePicker,
    handleFile,
    retryConvert,
    busy,
    uploadError,
    retrying,
    hasFile,
    isReady,
    isProcessing,
    isFailed,
  };
}
