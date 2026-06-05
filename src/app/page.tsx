import { redirect } from "next/navigation";

// The app's home is the Family app — the shared hub where everyone's posts land,
// so you arrive on what's new from the family. The personal Journal is one tab
// over; the practice book lives at /practice, gated to the owner in middleware.
export default function RootPage() {
  redirect("/family");
}
