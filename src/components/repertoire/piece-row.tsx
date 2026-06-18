"use client";

import Link from "next/link";
import { MusicIcon } from "lucide-react";
import type { Piece } from "@/lib/types";

export function PieceRow({
  piece,
  recognizable,
}: {
  piece: Piece;
  recognizable?: boolean;
}) {
  return (
    <div className="px-3 py-2 text-sm">
      <Link
        href={`/practice/repertoire/${piece.id}`}
        className="hover:underline"
      >
        {piece.name}
      </Link>
      {recognizable && (
        <MusicIcon
          className="ml-1.5 inline size-3 align-middle text-green-600 dark:text-green-500"
          aria-label="Reference MIDI on file — recognizable"
        />
      )}
    </div>
  );
}
