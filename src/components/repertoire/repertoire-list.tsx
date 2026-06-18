"use client";

import { useState, useMemo } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PieceFormDialog } from "./piece-form-dialog";
import { RepertoireGroupedList } from "./repertoire-grouped-list";
import type {
  Piece,
  Work,
  WorkWithPieces,
  PieceStatus,
} from "@/lib/types";
import { PIECE_STATUS_LABELS } from "@/lib/types";

type TabValue = PieceStatus | "all";
const TABS: TabValue[] = ["active", "upcoming", "archived", "all"];

export function RepertoireList({
  pieces,
  works,
  recognizablePieceIds = [],
}: {
  pieces: Piece[];
  works: WorkWithPieces[];
  recognizablePieceIds?: string[];
}) {
  const [activeTab, setActiveTab] = useState<TabValue>("active");
  const allWorks: Work[] = works;
  const recognizable = useMemo(
    () => new Set(recognizablePieceIds),
    [recognizablePieceIds]
  );

  const allPieces = useMemo(() => {
    const standalone = pieces.filter((p) => p.work_id === null);
    const fromWorks = works.flatMap((w) => w.pieces);
    return [...standalone, ...fromWorks];
  }, [pieces, works]);

  const tabPieces = useMemo(() => {
    if (activeTab === "all") return allPieces;
    return allPieces.filter((p) => p.status === activeTab);
  }, [allPieces, activeTab]);

  const counts = useMemo(() => {
    const out: Record<TabValue, number> = {
      active: 0,
      upcoming: 0,
      archived: 0,
      all: allPieces.length,
    };
    for (const p of allPieces) out[p.status] += 1;
    return out;
  }, [allPieces]);

  const composers = useMemo(() => {
    const set = new Set<string>();
    for (const p of allPieces) {
      const c = p.composer?.trim();
      if (c) set.add(c);
    }
    for (const w of works) {
      const c = w.composer?.trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allPieces, works]);

  const hasAnyPieces = allPieces.length > 0;

  return (
    <>
      <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6">
        <div className="flex items-center justify-between pl-8">
          <h1 className="text-2xl font-semibold tracking-tight">Repertoire</h1>
          <PieceFormDialog
            works={allWorks}
            composers={composers}
            trigger={
              <Button size="sm">
                <PlusIcon data-icon="inline-start" />
                Piece
              </Button>
            }
          />
        </div>
      </div>

      <div className="sticky top-14 z-40 mt-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-1 py-2 pl-8">
            {TABS.map((tab) => {
              const label = tab === "all" ? "All" : PIECE_STATUS_LABELS[tab];
              const isActive = activeTab === tab;
              const count = counts[tab];
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  )}
                >
                  {label}
                  {count > 0 && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px] px-1.5 py-0 min-w-5 h-5 justify-center",
                        isActive && "bg-primary-foreground/20 text-primary-foreground"
                      )}
                    >
                      {count}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-4 pt-6 pb-12 sm:px-6">
        <div className="pl-8">
          {!hasAnyPieces && (
            <p className="py-12 text-center text-muted-foreground">
              No pieces yet. Add your first piece to get started.
            </p>
          )}

          {hasAnyPieces && tabPieces.length === 0 && (
            <p className="py-12 text-center text-muted-foreground">
              No {activeTab === "all" ? "" : activeTab + " "}pieces.
            </p>
          )}

          {tabPieces.length > 0 && (
            <RepertoireGroupedList
              pieces={tabPieces}
              works={allWorks}
              recognizablePieceIds={recognizable}
            />
          )}
        </div>
      </div>
    </>
  );
}
