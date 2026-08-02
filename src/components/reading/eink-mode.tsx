"use client";

import { useEffect, useSyncExternalStore } from "react";
import { readerSettingsStore } from "@/lib/reading/reader-settings";

/**
 * E-ink mode, as a class on <html>.
 *
 * The class rather than a React-rendered theme because the whole point is to
 * repaint the palette, and every token in globals.css already resolves through a
 * custom property — so one class on the root element turns the entire app black
 * on white without a single component knowing about it. Portalled things
 * (dialogs, the annotation sheet) render at the document root, which is the
 * other reason it can't live on a wrapper inside the reader.
 *
 * The setting is per-device (localStorage), so a laptop and the e-reader
 * disagree about it permanently, which is correct.
 */

const STORAGE_KEY = "reader:layout";

/**
 * Runs before first paint, from <head>.
 *
 * Without this the server renders the cream palette, React hydrates, and the
 * whole screen flips to black-on-white a moment later. On an LCD that's a
 * flicker; on e-ink it's a full-screen repaint and a ghost, on every single
 * navigation. Same trick every theme switcher uses, and worth the inline script
 * here for the same reason.
 *
 * Deliberately silent on failure: if localStorage is unreachable the app is
 * simply not in e-ink mode, which is the safe direction.
 */
export const EINK_BOOT_SCRIPT = `
(function(){try{
var s=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
if(s&&JSON.parse(s).eink===true)document.documentElement.classList.add("eink");
}catch(e){}})();
`.trim();

/** Whether this device is set to e-ink mode. Safe to call during SSR (false). */
export function useEinkMode(): boolean {
  return useSyncExternalStore(
    readerSettingsStore.subscribe,
    () => readerSettingsStore.getSnapshot().eink,
    () => false
  );
}

/**
 * Keeps the class in step with the setting after boot — toggling it in the
 * Layout dialog, or in another tab. The boot script owns the first paint; this
 * owns every change after it.
 */
export function EinkModeSync() {
  const eink = useEinkMode();

  useEffect(() => {
    document.documentElement.classList.toggle("eink", eink);
  }, [eink]);

  return null;
}
