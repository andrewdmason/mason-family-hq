import type { Metadata } from "next";

// Single source of truth for each "app" inside Mason Family HQ — the name and
// icon iOS/Android use when you add a section to the home screen. From /workouts
// you install "Workouts" with the dumbbell tile; from /reader you install
// "Reader" with the book tile, and so on.
//
// Three consumers read this list:
//   • each route group's layout, via appMetadata() — sets the home-screen name
//     (apple-mobile-web-app-title) and links the matching per-app manifest;
//   • the /app-manifest route handler — serves the per-app web manifest that
//     Android/desktop installs use (name, start_url, icons);
//   • scripts/generate-icons.mjs — draws the matching icon art. Keep that list
//     in sync with this one (same keys), and with the app switcher's APPS.

export type PwaApp = {
  // Stable id. Also the ?app= manifest param and the icon filename stem.
  key: string;
  // Home-screen label / standalone app title.
  name: string;
  // Manifest short_name (what shows under the icon on Android).
  shortName: string;
  // Where the installed app opens (and the manifest scope anchor).
  startUrl: string;
  // The browser tab <title> for this section (kept distinct from `name`: the
  // home dashboard's app is branded "Family HQ" but its tab still reads "Home").
  pageTitle: string;
};

export const PWA_APPS: PwaApp[] = [
  { key: "home", name: "Family HQ", shortName: "Family HQ", startUrl: "/home", pageTitle: "Home" },
  { key: "family", name: "Family", shortName: "Family", startUrl: "/family", pageTitle: "Family" },
  { key: "reader", name: "Reader", shortName: "Reader", startUrl: "/reader", pageTitle: "Reader" },
  { key: "journal", name: "Journal", shortName: "Journal", startUrl: "/journal", pageTitle: "Journal" },
  { key: "timeline", name: "Timeline", shortName: "Timeline", startUrl: "/timeline", pageTitle: "Timeline" },
  { key: "calendar", name: "Calendar", shortName: "Calendar", startUrl: "/calendar", pageTitle: "Calendar" },
  { key: "assignments", name: "Assignments", shortName: "Assignments", startUrl: "/assignments", pageTitle: "Assignments" },
  { key: "workouts", name: "Workouts", shortName: "Workouts", startUrl: "/workouts", pageTitle: "Workouts" },
  { key: "practice", name: "Practice Log", shortName: "Practice", startUrl: "/practice", pageTitle: "Practice Log" },
];

const byKey = new Map(PWA_APPS.map((app) => [app.key, app]));

export function getPwaApp(key: string): PwaApp | undefined {
  return byKey.get(key);
}

// Metadata for a route group's layout: gives this section its own home-screen
// name and points the manifest link at its per-app manifest. The page <title>
// stays per-section too (the root template appends "· Mason Family HQ"). We
// re-state appleWebApp.capable/statusBarStyle because a child's appleWebApp
// replaces the root's wholesale rather than merging field-by-field.
export function appMetadata(key: string): Metadata {
  const app = getPwaApp(key);
  if (!app) return {};
  return {
    title: app.pageTitle,
    applicationName: app.name,
    appleWebApp: {
      capable: true,
      title: app.name,
      statusBarStyle: "default",
    },
    manifest: `/app-manifest?app=${app.key}`,
  };
}
