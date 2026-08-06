/** Shared shape between the scan and commit passes of the one-time eBook import. */

import type { OpfMetadata } from "./opf";

export type ExistingBook = {
  id: string;
  title: string;
  author: string | null;
  status: string;
};

export type ScannedBook = {
  /** Shared filename stem for this book's .epub/.opf/.jpg set. */
  stem: string;
  opf: OpfMetadata;
  /** Title as it would appear in the library. */
  title: string;
  author: string | null;
  year: number | null;
  isbn: string | null;
  openlibraryKey: string | null;
  coverImageUrl: string | null;
  /** Where the cover came from: openlibrary | epub | local | none. */
  coverSource: string;
  matchScore: number;
  matchVia: string | null;
  epubPath: string | null;
  epubBytes: number | null;
  /** An existing library book this one appears to be, if any. */
  duplicateOf: ExistingBook | null;
  /** create | attach | skip */
  action: string;
  /** Why it's being skipped, or what to watch out for. */
  notes: string[];
  /** Converter output summary, when the EPUB converted cleanly. */
  conversion: {
    ok: boolean;
    error: string | null;
    charCount: number;
    wordCount: number;
    hasRealPages: boolean;
    pageCount: number | null;
    pageRows: number;
    tocEntries: number;
    /** The page total the library would show. */
    totalPages: number | null;
    hasEpubCover: boolean;
  } | null;
};
