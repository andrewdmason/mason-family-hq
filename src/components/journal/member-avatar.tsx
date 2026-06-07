import { cn } from "@/lib/utils";

const SIZES = {
  xs: "h-4 w-4 text-[8px]",
  sm: "h-5 w-5 text-[9px]",
  md: "h-10 w-10 text-xs",
  lg: "h-11 w-11 text-sm",
  xl: "h-14 w-14 text-lg",
} as const;

function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

/** A circular member avatar: the photo when one is set, else initials on a
 * muted background. */
export function MemberAvatar({
  name,
  url,
  size = "md",
  className,
}: {
  name: string | null | undefined;
  url?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-serif uppercase text-muted-foreground select-none",
        SIZES[size],
        className
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
