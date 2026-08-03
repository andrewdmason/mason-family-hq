"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  chapterAtChar,
  cueAt,
  timeAtChar,
  type AudioChapter,
  type AudioCue,
  type AudioPlan,
  type AudioTimings,
} from "@/lib/reading/audio/types";
import {
  DEFAULT_LISTEN_SETTINGS,
  loadListenSettings,
  saveListenSettings,
  SKIP_BACK_MS,
  type SleepMode,
} from "@/lib/reading/audio/listen-settings";

/**
 * The voice, and everything that keeps it in step with the book.
 *
 * Mounted in the app shell rather than inside the reader, which is the whole
 * point: the reason to listen to a book is that you're doing something else,
 * and in this app "something else" is very often another part of this app.
 * Wandering off to the calendar has to leave the voice alone. A player that
 * lived inside the reader would stop dead on the first navigation, and that's a
 * bug you'd hit within an hour of using it.
 *
 * Two contexts, deliberately. Playback position ticks four times a second and
 * only the player bar cares; everything else — which chapter, which sentence,
 * playing or not — changes once every few seconds at most. Splitting them keeps
 * the reader from re-rendering an entire paginated book four times a second to
 * move a scrubber it isn't showing.
 */

export type ListenStatus =
  | "idle"
  | "preparing"
  | "ready"
  | "playing"
  | "paused"
  | "error";

export type AudiobookState = {
  bookId: string | null;
  title: string;
  author: string | null;
  chapters: AudioChapter[];
  chapterIndex: number | null;
  status: ListenStatus;
  error: string | null;
  /**
   * Where the voice is, in the book's character space — the same number the
   * reader stores as your reading position. Null when nothing is playing.
   */
  charOffset: number | null;
  /** The sentence being spoken, as a book character range. */
  cue: AudioCue | null;
  durationMs: number;
  rate: number;
  sleep: SleepMode;
  spentDollars: number;
};

export type AudiobookControls = {
  /** Start listening to a book from a character offset — usually where you were reading. */
  listen: (
    book: { bookId: string; title: string; author: string | null },
    charOffset: number
  ) => void;
  /**
   * Move the voice to a place in the book it is already reading — the other
   * direction from `listen`, and the one that makes turning a page while
   * listening mean something.
   */
  listenFrom: (charOffset: number) => void;
  toggle: () => void;
  pause: () => void;
  skipBack: () => void;
  goToChapter: (index: number) => void;
  nextChapter: () => void;
  previousChapter: () => void;
  seekTo: (ms: number) => void;
  setRate: (rate: number) => void;
  setSleep: (mode: SleepMode) => void;
  stop: () => void;
};

type PositionState = { positionMs: number; bufferedMs: number };

const StateContext = createContext<AudiobookState | null>(null);
const ControlsContext = createContext<AudiobookControls | null>(null);
const PositionContext = createContext<PositionState>({ positionMs: 0, bufferedMs: 0 });

export function useAudiobook(): AudiobookState {
  const value = useContext(StateContext);
  if (!value) throw new Error("useAudiobook must be used inside AudiobookProvider");
  return value;
}

export function useAudiobookControls(): AudiobookControls {
  const value = useContext(ControlsContext);
  if (!value) throw new Error("useAudiobookControls must be used inside AudiobookProvider");
  return value;
}

export function useAudiobookPosition(): PositionState {
  return useContext(PositionContext);
}

/**
 * A fraction of a second of silence.
 *
 * iOS will not let a page play audio unless the play() call happens inside a
 * real user gesture — and preparing a chapter takes the better part of a
 * minute, so by the time there is anything to play the tap is long over. Playing
 * this on the tap itself is what grants the element permission; everything
 * after that is allowed to be asynchronous.
 */
const SILENCE =
  "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tAwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u+7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v/////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYbcJqvBAAAAAAAAAAAAAAAAAAAA//sQxAADwAABpAAAACAAADSAAAAETEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxCmDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxFMDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

/** How often we ask the server whether a chapter has finished being voiced. */
const POLL_MS = 3000;

/** Give up waiting for a chapter after this long. */
const POLL_TIMEOUT_MS = 6 * 60 * 1000;

async function fetchPlan(bookId: string): Promise<AudioPlan> {
  const response = await fetch(`/reader/api/audio/${bookId}`, { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Couldn't load this book's chapters.");
  }
  return (await response.json()) as AudioPlan;
}

async function fetchTimings(bookId: string, index: number): Promise<AudioTimings | null> {
  try {
    const response = await fetch(`/reader/api/audio/${bookId}/${index}/timings`);
    if (!response.ok) return null;
    return (await response.json()) as AudioTimings;
  } catch {
    return null;
  }
}

export function AudiobookProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);

  const [state, setState] = useState<AudiobookState>({
    bookId: null,
    title: "",
    author: null,
    chapters: [],
    chapterIndex: null,
    status: "idle",
    error: null,
    charOffset: null,
    cue: null,
    durationMs: 0,
    rate: DEFAULT_LISTEN_SETTINGS.rate,
    sleep: null,
    spentDollars: 0,
  });
  const [position, setPosition] = useState<PositionState>({ positionMs: 0, bufferedMs: 0 });

  /**
   * The same state, readable without depending on it.
   *
   * The spoken sentence changes every few seconds, so anything that closes over
   * `state` gets a new identity that often. For the media-session handlers and
   * the end-of-chapter listener that would mean tearing down and re-registering
   * on every sentence, all night, for no reason.
   */
  const stateRef = useRef(state);
  stateRef.current = state;

  const cuesRef = useRef<AudioCue[]>([]);
  const currentCueRef = useRef<AudioCue | null>(null);
  const sleepRef = useRef<SleepMode>(null);
  const sleepDeadlineRef = useRef<number | null>(null);
  // Bumped on every new listen/chapter change so an in-flight load that has been
  // superseded knows to throw its result away rather than hijack the player.
  const loadIdRef = useRef(0);

  // ---- The element ---------------------------------------------------------

  const audio = useCallback((): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;
    const element = new Audio();
    element.preload = "auto";
    // Stops iOS Safari from taking a book over into its fullscreen video player.
    element.setAttribute("playsinline", "");
    audioRef.current = element;
    return element;
  }, []);

  /** Spend the user's tap on permission to play, before anything asynchronous. */
  const unlock = useCallback(() => {
    if (unlockedRef.current) return;
    const element = audio();
    if (element.src) {
      unlockedRef.current = true;
      return;
    }
    element.src = SILENCE;
    void element
      .play()
      .then(() => {
        element.pause();
        unlockedRef.current = true;
      })
      .catch(() => {
        // Not fatal — the browser may simply not need unlocking.
      });
  }, [audio]);

  // ---- Settings ------------------------------------------------------------

  useEffect(() => {
    const settings = loadListenSettings();
    setState((s) => ({ ...s, rate: settings.rate }));
    audio().playbackRate = settings.rate;
  }, [audio]);

  const setRate = useCallback(
    (rate: number) => {
      audio().playbackRate = rate;
      saveListenSettings({ rate });
      setState((s) => ({ ...s, rate }));
    },
    [audio]
  );

  // ---- Loading a chapter ---------------------------------------------------

  /**
   * Get a chapter voiced and return its timings.
   *
   * Asks once for it to be prepared, then waits. Preparation is claimed
   * server-side, so a second tab asking at the same moment joins the wait
   * rather than paying for a second copy of the same chapter — which is what
   * makes it safe to poll here instead of holding one very long request open.
   */
  const ensureChapter = useCallback(
    async (bookId: string, index: number, loadId: number): Promise<AudioTimings | null> => {
      const prepare = fetch(`/reader/api/audio/${bookId}/${index}/prepare`, {
        method: "POST",
      });
      // Deliberately not awaited before polling: it can run for the better part
      // of a minute, and we want the chapter list refreshing underneath it so
      // the reader sees progress rather than a frozen spinner.
      void prepare.catch(() => {});

      const deadline = Date.now() + POLL_TIMEOUT_MS;
      for (;;) {
        if (loadIdRef.current !== loadId) return null;

        const plan = await fetchPlan(bookId);
        if (loadIdRef.current !== loadId) return null;
        setState((s) =>
          s.bookId === bookId
            ? { ...s, chapters: plan.chapters, spentDollars: plan.spentDollars }
            : s
        );

        const chapter = plan.chapters.find((c) => c.index === index);
        if (!chapter) throw new Error("That chapter isn't part of this book.");
        if (chapter.status === "ready") return fetchTimings(bookId, index);
        if (chapter.status === "failed") {
          throw new Error(chapter.error ?? "Couldn't prepare this chapter.");
        }
        if (Date.now() > deadline) {
          throw new Error("This chapter is taking too long to prepare.");
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    },
    []
  );

  /** Prepare the chapter after this one, quietly, while you listen to this one. */
  const prefetchNext = useCallback((bookId: string, chapters: AudioChapter[], index: number) => {
    const next = chapters.find((c) => c.index === index + 1);
    if (!next || next.status !== "pending") return;
    void fetch(`/reader/api/audio/${bookId}/${next.index}/prepare`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  }, []);

  const startChapter = useCallback(
    async (
      book: { bookId: string; title: string; author: string | null },
      plan: AudioPlan,
      index: number,
      charOffset: number | null
    ) => {
      const loadId = ++loadIdRef.current;
      setState((s) => ({
        ...s,
        bookId: book.bookId,
        title: book.title,
        author: book.author,
        chapters: plan.chapters,
        spentDollars: plan.spentDollars,
        chapterIndex: index,
        status: "preparing",
        error: null,
        cue: null,
        charOffset,
      }));
      currentCueRef.current = null;
      cuesRef.current = [];

      try {
        const timings = await ensureChapter(book.bookId, index, loadId);
        if (loadIdRef.current !== loadId) return;

        cuesRef.current = timings?.cues ?? [];

        const element = audio();
        element.src = `/reader/api/audio/${book.bookId}/${index}`;
        element.playbackRate = stateRef.current.rate;
        element.currentTime =
          charOffset != null && cuesRef.current.length > 0
            ? timeAtChar(cuesRef.current, charOffset) / 1000
            : 0;

        setState((s) => ({
          ...s,
          status: "ready",
          durationMs: timings?.durationMs ?? 0,
        }));

        await element.play();
        if (loadIdRef.current !== loadId) return;
        setState((s) => ({ ...s, status: "playing" }));

        // The next chapter starts being made the moment this one starts playing
        // — that's the "chapter ahead" in chapter-ahead. By the time you get
        // there it's waiting, and you never paid for a chapter you didn't reach.
        prefetchNext(book.bookId, plan.chapters, index);
      } catch (err) {
        if (loadIdRef.current !== loadId) return;
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : "Couldn't play this chapter.",
        }));
      }
    },
    [audio, ensureChapter, prefetchNext]
  );

  // ---- Controls ------------------------------------------------------------

  const listen = useCallback(
    (book: { bookId: string; title: string; author: string | null }, charOffset: number) => {
      unlock();
      void (async () => {
        try {
          const plan = await fetchPlan(book.bookId);
          const chapter = chapterAtChar(plan.chapters, charOffset);
          if (!chapter) throw new Error("This book has nothing to listen to.");
          await startChapter(book, plan, chapter.index, charOffset);
        } catch (err) {
          setState((s) => ({
            ...s,
            bookId: book.bookId,
            title: book.title,
            author: book.author,
            status: "error",
            error: err instanceof Error ? err.message : "Couldn't start listening.",
          }));
        }
      })();
    },
    [startChapter, unlock]
  );

  /**
   * Take the voice to where the reader is.
   *
   * Inside the chapter already loaded this is a seek, because the timing map is
   * the inverse of the one that started playback here in the first place: a
   * character offset is a time. Further afield it's a chapter change, with the
   * cost that implies — a chapter nobody has listened to yet has to be voiced
   * first — which is the same bargain as skipping forward in the player, and is
   * why this is asked for rather than done automatically.
   *
   * The cue is published here rather than left to the next timeupdate. The
   * reader is already looking at this page, and a quarter of a second of the
   * old cue is long enough for the follow-along to conclude the voice has
   * wandered off and offer to bring it back to where it just left.
   */
  const listenFrom = useCallback(
    (charOffset: number) => {
      unlock();
      const { bookId, title, author, chapters, spentDollars, chapterIndex } = stateRef.current;
      if (!bookId) return;
      const chapter = chapterAtChar(chapters, charOffset);
      if (!chapter) return;

      if (chapter.index !== chapterIndex || cuesRef.current.length === 0) {
        void startChapter(
          { bookId, title, author },
          { bookId, title, author, chapters, spentDollars },
          chapter.index,
          charOffset
        );
        return;
      }

      const element = audio();
      const ms = timeAtChar(cuesRef.current, charOffset);
      element.currentTime = ms / 1000;
      const cue = cueAt(cuesRef.current, ms);
      currentCueRef.current = cue;
      setState((s) => ({ ...s, cue, charOffset: cue?.s ?? charOffset }));
      setPosition((p) => ({ ...p, positionMs: ms }));
      if (element.paused) void element.play().catch(() => {});
    },
    [audio, startChapter, unlock]
  );

  const goToChapter = useCallback(
    (index: number) => {
      unlock();
      const { bookId, title, author, chapters, spentDollars } = stateRef.current;
      if (!bookId) return;
      const chapter = chapters.find((c) => c.index === index);
      if (!chapter) return;
      void startChapter(
        { bookId, title, author },
        { bookId, title, author, chapters, spentDollars },
        index,
        chapter.charStart
      );
    },
    [startChapter, unlock]
  );

  const pause = useCallback(() => {
    audio().pause();
  }, [audio]);

  const toggle = useCallback(() => {
    unlock();
    const element = audio();
    if (element.paused) void element.play().catch(() => {});
    else element.pause();
  }, [audio, unlock]);

  const seekTo = useCallback(
    (ms: number) => {
      const element = audio();
      if (!Number.isFinite(element.duration)) return;
      element.currentTime = Math.max(0, Math.min(element.duration, ms / 1000));
    },
    [audio]
  );

  const skipBack = useCallback(() => {
    const element = audio();
    element.currentTime = Math.max(0, element.currentTime - SKIP_BACK_MS / 1000);
  }, [audio]);

  const nextChapter = useCallback(() => {
    const index = stateRef.current.chapterIndex;
    if (index == null) return;
    goToChapter(index + 1);
  }, [goToChapter]);

  const previousChapter = useCallback(() => {
    const index = stateRef.current.chapterIndex;
    if (index == null || index === 0) return;
    goToChapter(index - 1);
  }, [goToChapter]);

  const setSleep = useCallback((mode: SleepMode) => {
    sleepRef.current = mode;
    sleepDeadlineRef.current =
      typeof mode === "number" ? Date.now() + mode * 60_000 : null;
    setState((s) => ({ ...s, sleep: mode }));
  }, []);

  const stop = useCallback(() => {
    loadIdRef.current++;
    const element = audio();
    element.pause();
    element.removeAttribute("src");
    element.load();
    cuesRef.current = [];
    currentCueRef.current = null;
    sleepRef.current = null;
    sleepDeadlineRef.current = null;
    setState({
      bookId: null,
      title: "",
      author: null,
      chapters: [],
      chapterIndex: null,
      status: "idle",
      error: null,
      charOffset: null,
      cue: null,
      durationMs: 0,
      rate: stateRef.current.rate,
      sleep: null,
      spentDollars: 0,
    });
    setPosition({ positionMs: 0, bufferedMs: 0 });
  }, [audio]);

  // ---- The clock -----------------------------------------------------------

  useEffect(() => {
    const element = audio();

    const onTime = () => {
      const ms = element.currentTime * 1000;
      const buffered =
        element.buffered.length > 0
          ? element.buffered.end(element.buffered.length - 1) * 1000
          : 0;
      setPosition({ positionMs: ms, bufferedMs: buffered });

      // The follow-along cue only moves once a sentence, so it's compared before
      // being written. Without that this would re-render the reader — an entire
      // paginated book — four times a second to say nothing had changed.
      const cue = cueAt(cuesRef.current, ms);
      if (cue !== currentCueRef.current) {
        currentCueRef.current = cue;
        setState((s) => ({ ...s, cue, charOffset: cue?.s ?? s.charOffset }));
      }

      const deadline = sleepDeadlineRef.current;
      if (deadline != null && Date.now() >= deadline) {
        sleepDeadlineRef.current = null;
        sleepRef.current = null;
        element.pause();
        setState((s) => ({ ...s, sleep: null }));
      }
    };

    const onPlay = () => setState((s) => ({ ...s, status: "playing" }));
    const onPause = () =>
      setState((s) => (s.status === "playing" ? { ...s, status: "paused" } : s));
    const onDuration = () => {
      if (Number.isFinite(element.duration)) {
        setState((s) => ({ ...s, durationMs: element.duration * 1000 }));
      }
    };
    const onError = () =>
      setState((s) =>
        s.status === "idle"
          ? s
          : { ...s, status: "error", error: "This chapter wouldn't play." }
      );

    element.addEventListener("timeupdate", onTime);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    element.addEventListener("loadedmetadata", onDuration);
    element.addEventListener("durationchange", onDuration);
    element.addEventListener("error", onError);
    return () => {
      element.removeEventListener("timeupdate", onTime);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("loadedmetadata", onDuration);
      element.removeEventListener("durationchange", onDuration);
      element.removeEventListener("error", onError);
    };
  }, [audio]);

  // Rolling on to the next chapter, unless the sleep timer said this was the last.
  useEffect(() => {
    const element = audio();
    const onEnded = () => {
      if (sleepRef.current === "chapter") {
        sleepRef.current = null;
        setState((s) => ({ ...s, sleep: null, status: "paused" }));
        return;
      }
      const { chapterIndex, chapters } = stateRef.current;
      if (chapterIndex == null) return;
      const next = chapters.find((c) => c.index === chapterIndex + 1);
      if (next) goToChapter(next.index);
      else setState((s) => ({ ...s, status: "paused" }));
    };
    element.addEventListener("ended", onEnded);
    return () => element.removeEventListener("ended", onEnded);
  }, [audio, goToChapter]);

  // ---- Lock screen, headphones, car ----------------------------------------

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if (!state.bookId) {
      session.metadata = null;
      session.playbackState = "none";
      return;
    }
    const chapter = state.chapters.find((c) => c.index === state.chapterIndex);
    session.metadata = new MediaMetadata({
      title: chapter?.title ?? state.title,
      artist: state.author ?? "",
      album: state.title,
    });
    session.playbackState = state.status === "playing" ? "playing" : "paused";
  }, [state.author, state.bookId, state.chapterIndex, state.chapters, state.status, state.title]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ["play", () => toggle()],
      ["pause", () => pause()],
      // Mapped to chapters rather than tracks because a book's tracks ARE its
      // chapters — the headphone gesture people already know does the useful thing.
      ["previoustrack", () => previousChapter()],
      ["nexttrack", () => nextChapter()],
      ["seekbackward", () => skipBack()],
      [
        "seekto",
        (details) => {
          if (details.seekTime != null) seekTo(details.seekTime * 1000);
        },
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Not every browser supports every action; the rest still work.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // As above.
        }
      }
    };
  }, [nextChapter, pause, previousChapter, seekTo, skipBack, toggle]);

  const controls = useMemo<AudiobookControls>(
    () => ({
      listen,
      listenFrom,
      toggle,
      pause,
      skipBack,
      goToChapter,
      nextChapter,
      previousChapter,
      seekTo,
      setRate,
      setSleep,
      stop,
    }),
    [
      goToChapter,
      listen,
      listenFrom,
      nextChapter,
      pause,
      previousChapter,
      seekTo,
      setRate,
      setSleep,
      skipBack,
      stop,
      toggle,
    ]
  );

  return (
    <StateContext.Provider value={state}>
      <ControlsContext.Provider value={controls}>
        <PositionContext.Provider value={position}>{children}</PositionContext.Provider>
      </ControlsContext.Provider>
    </StateContext.Provider>
  );
}
