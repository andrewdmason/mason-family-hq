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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { groupPiecesForMenu } from "@/lib/piece-menu";

const FOCUS_VIEW = "next-session";

export function PracticeLogHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const focusParam = searchParams.get("focus");
  const viewParam = searchParams.get("view");
  const isFocusView = viewParam === FOCUS_VIEW;

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
    (focusKey: string | null, view: string | null) => {
      const params = new URLSearchParams();
      if (focusKey) params.set("focus", focusKey);
      if (view) params.set("view", view);
      const qs = params.toString();
      return qs ? `/practice?${qs}` : "/practice";
    },
    []
  );

  const setUrlState = useCallback(
    (pieceId: string | null, view: string | null) => {
      const url = buildUrl(pieceId, view);
      if (pathname !== "/practice") {
        router.push(url);
        return;
      }
      window.history.replaceState(null, "", url);
    },
    [pathname, router, buildUrl]
  );

  const currentView = isFocusView ? FOCUS_VIEW : null;

  const handleFocusClick = useCallback(() => {
    setActivePieceInstance(null);
    setUrlState(focusedPieceId, isFocusView ? null : FOCUS_VIEW);
  }, [focusedPieceId, isFocusView, setActivePieceInstance, setUrlState]);

  const clearFocus = useCallback(() => {
    setFocusedPieceId(null);
    setActivePieceInstance(null);
    setUrlState(null, currentView);
  }, [setFocusedPieceId, setActivePieceInstance, setUrlState, currentView]);

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
    function isTypingTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Escape clears whichever is most "active" — the specific instance
        // first, then piece focus, then the view filter.
        if (activePieceInstance) {
          setActivePieceInstance(null);
          return;
        }
        if (focusedPieceId) {
          clearFocus();
          return;
        }
        if (isFocusView) {
          setUrlState(null, null);
        }
        return;
      }
      if (e.key === "f" || e.key === "F") {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        handleFocusClick();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activePieceInstance,
    focusedPieceId,
    isFocusView,
    clearFocus,
    handleFocusClick,
    setActivePieceInstance,
    setUrlState,
  ]);

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

  const focusedPiece = focusedPieceId
    ? activePieces.find((p) => p.id === focusedPieceId)
    : null;

  // The "Pieces" menu is a quick-add action, not a filter: picking a piece
  // appends it to today and makes it the active timer item. PracticeTable owns
  // the add + timer-start (it knows today's sessions), so we just announce the
  // pick here.
  const quickAddPiece = useCallback((pieceId: string) => {
    window.dispatchEvent(
      new CustomEvent("practice-quick-add-piece", { detail: { pieceId } })
    );
  }, []);

  const menuEntries = useMemo(
    () => groupPiecesForMenu(activePieces, worksById),
    [activePieces, worksById]
  );

  const title = focusedPiece
    ? `Practice Log: ${focusedPiece.name}`
    : "Practice Log";

  return (
    <div onClick={handleHeaderClick}>
      <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6">
        <div className="pl-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        </div>
      </div>
      <div
        ref={stickyRef}
        className={cn(
          "sticky top-14 z-40 mt-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
          !isStuck && "border-transparent"
        )}
      >
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-3 py-2 pl-8">
            <label
              className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground select-none cursor-pointer"
              title="Focus (F)"
            >
              <Switch
                checked={isFocusView}
                onCheckedChange={handleFocusClick}
              />
              <span className={cn(isFocusView && "text-foreground")}>Focus</span>
            </label>
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
  );
}
