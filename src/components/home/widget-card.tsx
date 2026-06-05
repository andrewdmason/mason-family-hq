import Link from "next/link";
import type { ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The shared shell for a Home dashboard widget: a Card with a serif title row
 * (icon + label) that can link to the app, plus an optional action area. Body
 * content is passed as children.
 */
export function WidgetCard({
  title,
  icon: Icon,
  href,
  hrefLabel,
  action,
  className,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  /** Where the title links — the app this widget is a window into. */
  href?: string;
  hrefLabel?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const titleContent = (
    <>
      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      {title}
    </>
  );

  return (
    <Card className={cn("gap-3", className)}>
      <div className="flex items-center justify-between gap-2 px-4">
        <h2 className="min-w-0 font-serif text-base text-foreground">
          {href ? (
            <Link
              href={href}
              aria-label={hrefLabel ?? `Open ${title}`}
              className="flex min-w-0 items-center gap-2 rounded-sm transition-colors hover:text-foreground/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {titleContent}
            </Link>
          ) : (
            <span className="flex min-w-0 items-center gap-2">{titleContent}</span>
          )}
        </h2>
        {action && (
          <div className="flex shrink-0 items-center justify-end">{action}</div>
        )}
      </div>
      <div className="px-4">{children}</div>
    </Card>
  );
}
