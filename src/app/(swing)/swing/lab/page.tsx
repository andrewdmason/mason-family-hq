import type { Metadata } from "next";
import { LabShell } from "@/components/swing/lab/lab-shell";

export const metadata: Metadata = { title: "Extraction Lab" };

// U1 spike harness, kept as a diagnostics page: run the pose-extraction
// pipeline on a local clip entirely in-browser and inspect every readout
// (probe, benchmark, phase events, metrics, stills, wrist trackability).
// No data fetch — everything happens client-side and nothing is persisted.
export default function SwingLabPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
      <h1 className="font-serif text-2xl tracking-tight">Extraction Lab</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Diagnostics for the swing extraction pipeline: drop a clip, run pose
        extraction locally, and inspect decode, benchmark, and tracking
        quality. Used to validate pose fidelity and record the U1 spike
        decisions.
      </p>
      <LabShell />
    </main>
  );
}
