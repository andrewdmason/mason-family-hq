/**
 * The dashboard's hero line: the day's date over a plain welcome. Deliberately
 * static — no AI-generated "commentary on your day" line (that read as gimmicky),
 * just a calm header that orients the page.
 */
export function GreetingHeader({
  name,
  dateLabel,
}: {
  name: string;
  dateLabel: string;
}) {
  return (
    <header className="mb-8">
      <p className="font-serif text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {dateLabel}
      </p>
      <h1 className="mt-2 font-serif text-2xl leading-snug text-foreground sm:text-3xl">
        Welcome back, {name}.
      </h1>
    </header>
  );
}
