import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/**
 * Mobile-only back chevron, like Things on iPhone: views and projects are
 * full-screen on phones (the sidebar rail is desktop-only), so each one
 * carries a `‹` in its top-left returning to the lists screen (/todos/browse).
 */
export function BackToLists({ href }: { href: string }) {
  return (
    <div className="md:hidden">
      <Link
        href={href}
        aria-label="Back to lists"
        className="-ml-2 inline-flex cursor-default items-center rounded-lg p-1 text-muted-foreground active:bg-accent/50"
      >
        <ChevronLeft className="size-6" />
      </Link>
    </div>
  );
}
