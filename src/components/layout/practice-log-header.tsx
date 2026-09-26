"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { useTaskTimer } from "@/components/timer/task-timer-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { groupPiecesForMenu } from "@/lib/piece-menu";
import { DayTitle } from "@/components/practice-table/day-title";

export function PracticeLogHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const focusParam = searchParams.get("focus");

  const {
    activePieces,
    worksById,
    focusedPieceId,
    setFocusedPieceId,
    activePieceInstance,
    setActivePieceInstance,
  } = useTaskTimer();

  useEffect(() => {
    if (pathname !== "/practice") return;
    if (!focusParam) {
      if (focusedPieceId) setFocusedPieceId(null);
      return;
    }
    if (focusedPieceId === focusParam) return;

    const piece = activePieces.find((p) => p.id === focusParam);
    if (piece) {
      setFocusedPieceId(piece.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusParam, pathname]);

  const buildUrl = useCallback(
    (focusKey: string | null) => {
      const params = new URLSearchParams();
      if (focusKey) params.set("focus", focusKey);
      // Keep the day being viewed.
      const date = new URLSearchParams(window.location.search).get("date");
      if (date && pathname === "/practice") params.set("date", date);
      const qs = params.toString();
      return qs ? `/practice?${qs}` : "/practice";
    },
    [pathname]
  );

  const setUrlState = useCallback(
    (pieceId: string | null) => {
      const url = buildUrl(pieceId);
      if (pathname !== "/practice") {
        router.push(url);
        return;
      }
      window.history.replaceState(null, "", url);
    },
    [pathname, router, buildUrl]
  );

  const clearFocus = useCallback(() => {
    setFocusedPieceId(null);
    setActivePieceInstance(null);
    setUrlState(null);
  }, [setFocusedPieceId, setActivePieceInstance, setUrlState]);

  const handleHeaderClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.closest("button")) return;
      // Header chrome clicks only deactivate the specific piece instance;
      // they leave the filter intact.
      if (activePieceInstance) setActivePieceInstance(null);
    },
    [activePieceInstance, setActivePieceInstance]
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Escape clears whichever is most "active" — the specific instance
      // first, then piece focus.
      if (activePieceInstance) {
        setActivePieceInstance(null);
        return;
      }
      if (focusedPieceId) clearFocus();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePieceInstance, focusedPieceId, clearFocus, setActivePieceInstance]);

  const stickyRef = useRef<HTMLDivElement>(null);
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const el = stickyRef.current;
    if (!el) return;
    function checkStuck() {
      if (!el) return;
      setIsStuck(el.getBoundingClientRect().top <= 56);
    }
    checkStuck();
    window.addEventListener("scroll", checkStuck, { passive: true });
    window.addEventListener("resize", checkStuck);
    return () => {
      window.removeEventListener("scroll", checkStuck);
      window.removeEventListener("resize", checkStuck);
    };
  }, []);

  // The "Pieces" menu is a quick-add action, not a filter: picking a piece
  // appends it to the day on screen, and on today makes it the active timer
  // item. PracticeTable owns the add + timer-start (it knows the day's
  // sessions), so we just announce the pick here.
  const quickAddPiece = useCallback((pieceId: string) => {
    window.dispatchEvent(
      new CustomEvent("practice-quick-add-piece", { detail: { pieceId } })
    );
  }, []);

  const menuEntries = useMemo(
    () => groupPiecesForMenu(activePieces, worksById),
    [activePieces, worksById]
  );

  return (
    <div onClick={handleHeaderClick}>
      <div
        ref={stickyRef}
        className={cn(
          "sticky top-14 z-40 mt-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
          !isStuck && "border-transparent"
        )}
      >
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 pl-8">
            <DayTitle />
            <div className="ml-auto flex items-center gap-3">
            {activePieces.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                    "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  )}
                >
                  <PlusIcon className="size-3" />
                  Pieces
                  <ChevronDownIcon className="size-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80 w-56">
                  {menuEntries.map((entry) =>
                    entry.kind === "piece" ? (
                      <DropdownMenuItem
                        key={entry.piece.id}
                        onClick={() => quickAddPiece(entry.piece.id)}
                      >
                        {entry.piece.name}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuSub key={entry.workId}>
                        <DropdownMenuSubTrigger>
                          {entry.name}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {entry.pieces.map((piece) => (
                            <DropdownMenuItem
                              key={piece.id}
                              onClick={() => quickAddPiece(piece.id)}
                            >
                              {piece.name}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
