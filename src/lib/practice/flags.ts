// Gates the listen-and-auto-log feature. NEXT_PUBLIC_ so both the server (page
// access) and the client (nav link) read the same value. Off unless explicitly
// set to "true" — manual practice logging is unaffected either way.
export const PRACTICE_AUTOLOG_ENABLED =
  process.env.NEXT_PUBLIC_PRACTICE_AUTOLOG_ENABLED === "true";
