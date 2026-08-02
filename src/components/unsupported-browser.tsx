/**
 * The "this browser is too old" notice — the one piece of the app that has to
 * work in a browser the app doesn't support.
 *
 * Why it exists: Next 16 targets Chrome 111+ and Tailwind v4 needs the same
 * era, and when a browser falls below that the app doesn't degrade, it dies
 * silently. Two things happen at once, and neither prints anything a person can
 * see:
 *
 *   • 91% of the compiled stylesheet is wrapped in `@layer` blocks — theme,
 *     preflight, and every utility class. Cascade layers landed in Chrome 99,
 *     and a browser that doesn't know the at-rule discards the whole block, so
 *     the page renders as bare unstyled HTML.
 *   • The client bundle is compiled for Chrome 111 and calls things like
 *     Object.hasOwn (Chrome 93). Hydration throws, no handler is ever attached,
 *     and every button on the page becomes decorative.
 *
 * A person hitting this taps "Sign in with Google" on what looks like a broken
 * 1996 web page and nothing happens. That's the bug this fixes: not to make the
 * app run on old engines — it can't — but to say so out loud.
 *
 * Which means this notice cannot use any of the app's own machinery. Not
 * Tailwind (dropped with the rest of the layers), not a client component, not
 * JS at all. It's server-rendered markup plus one inline <style>, and it decides
 * whether to show itself with `@supports`, which the CSS parser evaluates on its
 * own: modern browsers match the query and hide the notice, old ones fail the
 * query, never apply the hiding rule, and show it. Failing toward "visible" is
 * the right direction — a browser too old to parse the test is exactly the
 * browser that needs the message.
 *
 * The probe is `color-mix()` in oklab, chosen because it isn't a proxy for the
 * problem, it *is* the problem: it shipped in Chrome 111 / Safari 16.2 alongside
 * the rest of this baseline, and the compiled stylesheet uses it 479 times.
 */

// Everything the notice needs, in CSS old enough that the browsers being warned
// can parse it — no custom properties, no oklch, no logical properties.
const NOTICE_CSS = `
#unsupported-browser {
  margin: 0;
  padding: 16px 20px;
  background: #fdf6e3;
  border-bottom: 2px solid #7f4327;
  color: #2b1a12;
  font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  text-align: left;
}
#unsupported-browser b {
  display: block;
  margin-bottom: 6px;
  font-size: 16px;
}
#unsupported-browser a {
  color: #7f4327;
}
@supports (color: color-mix(in oklab, red, blue)) {
  #unsupported-browser { display: none; }
}
`;

/** Renders nothing visible on a supported browser. See the note above. */
export function UnsupportedBrowser() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: NOTICE_CSS }} />
      <div id="unsupported-browser">
        <b>This browser is too old to run Family HQ.</b>
        Sign-in and styling need Chrome 111+, Safari 16.4+, or Firefox 111+ —
        anything from 2023 on. If you&apos;re on a Boox or another e-ink Android
        device, its built-in NeoBrowser is the usual cause: it&apos;s still on
        Chromium 85. Install Chrome, Brave, or Edge from the Play Store and open
        this page there.
      </div>
    </>
  );
}
