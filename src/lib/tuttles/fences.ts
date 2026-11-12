/**
 * Lifts some fenced blocks out of the tutor's reply while it streams.
 *
 * The tutor writes quiz questions (```question), its call on an answer
 * (```grade) and study sets (```studyset) as fenced JSON in its reply, the way
 * it already writes ```visual blocks. Those carry things the student mustn't
 * see (a question's answer) or the server must act on first (saving a set),
 * so they never reach the phone as written: each is held until its closing
 * fence, handed to `handle`, and whatever that returns goes out in its place
 * (a cleaned-up block with an id, or nothing).
 *
 * Everything else streams straight through, except the start of a line that
 * might be a fence, which waits until the line is whole.
 */
export class FenceFilter {
  private pending = "";
  private atLineStart = true;
  private fence: { lang: string; body: string[] } | null = null;

  constructor(
    private readonly langs: ReadonlySet<string>,
    private readonly handle: (lang: string, body: string) => Promise<string>,
  ) {}

  /** Takes the next piece of the reply; returns what can be shown now. */
  async push(delta: string): Promise<string> {
    this.pending += delta;
    let out = "";
    for (;;) {
      if (this.fence) {
        const nl = this.pending.indexOf("\n");
        if (nl < 0) return out;
        const line = this.pending.slice(0, nl);
        this.pending = this.pending.slice(nl + 1);
        if (line.trim().startsWith("```")) {
          const { lang, body } = this.fence;
          this.fence = null;
          this.atLineStart = true;
          out += await this.handle(lang, body.join("\n"));
        } else {
          this.fence.body.push(line);
        }
        continue;
      }
      if (!this.pending) return out;
      if (this.atLineStart) {
        const nl = this.pending.indexOf("\n");
        const head = (nl < 0 ? this.pending : this.pending.slice(0, nl)).trimStart();
        if (nl < 0) {
          // Could still turn out to be a fence: wait for the rest of the line.
          if ("```".startsWith(head.slice(0, 3)) || head.startsWith("```")) return out;
          out += this.pending;
          this.pending = "";
          this.atLineStart = false;
          return out;
        }
        const open = head.match(/^```\s*([A-Za-z]+)\s*$/);
        if (open && this.langs.has(open[1].toLowerCase())) {
          this.fence = { lang: open[1].toLowerCase(), body: [] };
          this.pending = this.pending.slice(nl + 1);
          continue;
        }
        out += this.pending.slice(0, nl + 1);
        this.pending = this.pending.slice(nl + 1);
        continue;
      }
      const nl = this.pending.indexOf("\n");
      if (nl < 0) {
        out += this.pending;
        this.pending = "";
        return out;
      }
      out += this.pending.slice(0, nl + 1);
      this.pending = this.pending.slice(nl + 1);
      this.atLineStart = true;
    }
  }

  /** The reply's over: whatever's held. A block left open is handled as if it had closed. */
  async end(): Promise<string> {
    let out = "";
    if (this.fence) {
      const { lang, body } = this.fence;
      this.fence = null;
      const rest = this.pending.trim().startsWith("```") ? [] : this.pending ? [this.pending] : [];
      out += await this.handle(lang, [...body, ...rest].join("\n"));
    } else {
      out += this.pending;
    }
    this.pending = "";
    return out;
  }
}
