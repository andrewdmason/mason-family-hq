import { Loader2 } from "lucide-react";

// The player is full-bleed black; hold that while the at-bat loads so opening
// one doesn't flash the light app shell.
export default function AtBatLoading() {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black">
      <Loader2 className="size-8 animate-spin text-white/60" />
    </div>
  );
}
