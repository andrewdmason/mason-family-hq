import { redirect } from "next/navigation";
import { DevRootRedirect } from "@/components/layout/dev-root-redirect";

// The app's home is the Home dashboard — a personalized, per-member window into
// every app they have access to (journals, reader, calendar, practice). The
// Family feed is one tab over; the practice book lives at /practice, gated to
// the owner in middleware.
//
// In local development, jump back to whichever app you were last in (remembered
// in localStorage by LastAppTracker) so the dev loop doesn't always dump you on
// Home. Production always lands on the Home dashboard.
export default function RootPage() {
  if (process.env.NODE_ENV === "development") {
    return <DevRootRedirect />;
  }
  redirect("/home");
}
