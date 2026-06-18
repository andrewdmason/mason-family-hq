"use client";

import Link from "next/link";
import { Fragment } from "react";
import { MusicIcon } from "lucide-react";
import type { Work, Piece } from "@/lib/types";

export function WorkRow({
  work,
  pieces,
  recognizablePieceIds,
}: {
  work: Work;
  pieces: Piece[];
  recognizablePieceIds?: Set<string>;
}) {
  return (
    <div className="px-3 py-2 text-sm">
      <Link
        href={`/practice/repertoire/works/${work.id}`}
        className="font-medium hover:underline"
      >
        {work.name}
      </Link>
      {pieces.length > 0 && (
        <>
          {": "}
          {pieces.map((piece, i) => (
            <Fragment key={piece.id}>
              {i > 0 && ", "}
              <Link
                href={`/practice/repertoire/${piece.id}`}
                className="hover:underline"
              >
                {piece.name}
              </Link>
              {recognizablePieceIds?.has(piece.id) && (
                <MusicIcon
                  className="ml-1 inline size-3 align-middle text-green-600 dark:text-green-500"
                  aria-label="Reference MIDI on file — recognizable"
                />
              )}
            </Fragment>
          ))}
        </>
      )}
    </div>
  );
}
