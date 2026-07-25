"use client";

import { useState, useSyncExternalStore } from "react";
import { perfEntries, perfVersion, subscribePerf } from "@/lib/reading/perf";

/**
 * The timings, on the screen they were measured on.
 *
 * The device this reader feels slow on is an iPad, usually not tethered to
 * anything, so the numbers have to be readable without a Web Inspector. Turn it
 * on with `localStorage.setItem("reader:perf", "1")` and reload; with it off
 * nothing is ever recorded, the version stays at 0, and this renders nothing.
 * See lib/reading/perf.ts.
 */
export function ReaderPerfOverlay() {
  const [collapsed, setCollapsed] = useState(false);
  // Zero on the server and through hydration, so there's nothing to mismatch.
  const version = useSyncExternalStore(subscribePerf, perfVersion, zero);

  if (version === 0) return null;
  const shown = perfEntries().slice(-12);

  return (
    <div
      onClick={() => setCollapsed((c) => !c)}
      className="fixed right-2 bottom-2 z-100 max-w-[22rem] rounded bg-black/80 px-2 py-1.5 font-mono text-[10px] leading-tight text-lime-300"
    >
      {collapsed ? (
        <div>reader:perf ({shown.length})</div>
      ) : (
        shown.map((e, i) => (
          <div key={`${e.at}-${i}`} className="whitespace-nowrap">
            <span className={e.ms >= 100 ? "text-red-400" : e.ms >= 30 ? "text-amber-300" : ""}>
              {e.ms > 0 ? `${e.ms.toFixed(0)}ms`.padStart(6, " ") : "    ·"}
            </span>{" "}
            {e.label}
            {e.detail ? <span className="text-lime-500/70"> {e.detail}</span> : null}
          </div>
        ))
      )}
    </div>
  );
}

function zero() {
  return 0;
}
