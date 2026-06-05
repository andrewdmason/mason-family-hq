import { redirect } from "next/navigation";

// The app's home is the Home dashboard — a personalized, per-member window into
// every app they have access to (journals, reader, calendar, practice). The
// Family feed is one tab over; the practice book lives at /practice, gated to
// the owner in middleware.
export default function RootPage() {
  redirect("/home");
}
