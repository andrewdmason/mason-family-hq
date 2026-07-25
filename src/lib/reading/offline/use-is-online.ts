"use client";

import { useEffect, useState } from "react";

/**
 * Whether the browser thinks it can reach the network.
 *
 * Starts optimistic and corrects on mount, because `navigator.onLine` doesn't
 * exist during the server render and a control that flickers from disabled to
 * enabled reads as broken.
 *
 * Worth knowing: `onLine` is only honest about being *offline*. It can happily
 * report true behind a captive portal or a dead uplink, so this is right for
 * disabling things that obviously cannot work — asking an AI a question — and
 * wrong as a guarantee that anything will succeed. Whatever it gates still needs
 * its own error path.
 */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return online;
}
