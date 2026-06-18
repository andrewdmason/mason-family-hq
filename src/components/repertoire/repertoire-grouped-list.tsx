"use client";

import { useMemo } from "react";
import { PieceRow } from "./piece-row";
import { WorkRow } from "./work-row";
import type { Piece, Work } from "@/lib/types";
import { TECHNIQUE_PIECE_ID, SIGHT_READING_PIECE_ID } from "@/lib/types";

type ComposerItem =
  | { type: "piece"; piece: Piece }
  | { type: "work"; work: Work; pieces: Piece[] };

type ComposerGroup = {
  label: string;
  items: ComposerItem[];
};

function buildGroups(
  pieces: Piece[],
  works: Work[]
): {
  technique: Piece | null;
  sightReading: Piece | null;
  composers: ComposerGroup[];
} {
  const technique =
    pieces.find((p) => p.id === TECHNIQUE_PIECE_ID) ?? null;
  const sightReading =
    pieces.find((p) => p.id === SIGHT_READING_PIECE_ID) ?? null;

  const real = pieces.filter(
    (p) => p.id !== TECHNIQUE_PIECE_ID && p.id !== SIGHT_READING_PIECE_ID
  );

  const workMap = new Map(works.map((w) => [w.id, w]));

  // Bucket pieces by composer key. For pieces in a work, the work's
  // composer wins (so all movements stay together under one composer).
  const byComposer = new Map<string, Piece[]>();
  for (const piece of real) {
    let composerKey: string;
    if (piece.work_id) {
      const work = workMap.get(piece.work_id);
      composerKey = (work?.composer ?? piece.composer ?? "").trim();
    } else {
      composerKey = (piece.composer ?? "").trim();
    }
    const list = byComposer.get(composerKey) ?? [];
    list.push(piece);
    byComposer.set(composerKey, list);
  }

  const composerKeys = [...byComposer.keys()].sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b);
  });

  const composers: ComposerGroup[] = composerKeys.map((key) => {
    const piecesForComposer = byComposer.get(key)!;
    const standalone = piecesForComposer.filter((p) => !p.work_id);

    const worksForComposer = new Map<string, Piece[]>();
    for (const piece of piecesForComposer) {
      if (!piece.work_id) continue;
      const list = worksForComposer.get(piece.work_id) ?? [];
      list.push(piece);
      worksForComposer.set(piece.work_id, list);
    }

    const items: ComposerItem[] = [
      ...standalone.map(
        (p): ComposerItem => ({ type: "piece", piece: p })
      ),
      ...[...worksForComposer.entries()]
        .map(([id, ps]): ComposerItem | null => {
          const work = workMap.get(id);
          if (!work) return null;
          return {
            type: "work",
            work,
            pieces: ps.sort((a, b) => a.name.localeCompare(b.name)),
          };
        })
        .filter((x): x is ComposerItem => x !== null),
    ];

    items.sort((a, b) => {
      const aName = a.type === "piece" ? a.piece.name : a.work.name;
      const bName = b.type === "piece" ? b.piece.name : b.work.name;
      return aName.localeCompare(bName);
    });

    return { label: key || "Unknown composer", items };
  });

  return { technique, sightReading, composers };
}

export function RepertoireGroupedList({
  pieces,
  works,
  recognizablePieceIds,
}: {
  pieces: Piece[];
  works: Work[];
  recognizablePieceIds?: Set<string>;
}) {
  const groups = useMemo(
    () => buildGroups(pieces, works),
    [pieces, works]
  );

  if (pieces.length === 0) return null;

  const hasSystem = !!groups.technique || !!groups.sightReading;

  return (
    <div className="space-y-8">
      {hasSystem && (
        <section>
          {groups.technique && <PieceRow piece={groups.technique} />}
          {groups.sightReading && <PieceRow piece={groups.sightReading} />}
        </section>
      )}

      {groups.composers.map((group) => (
        <section key={group.label}>
          <h3 className="mb-1 px-1 text-lg font-semibold">{group.label}</h3>
          <div>
            {group.items.map((item) =>
              item.type === "piece" ? (
                <PieceRow
                  key={item.piece.id}
                  piece={item.piece}
                  recognizable={recognizablePieceIds?.has(item.piece.id)}
                />
              ) : (
                <WorkRow
                  key={item.work.id}
                  work={item.work}
                  pieces={item.pieces}
                  recognizablePieceIds={recognizablePieceIds}
                />
              )
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
