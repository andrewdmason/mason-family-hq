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
  // The browser tab <title> for this section. Each app reads as a standalone
  // product ("Todos", "Calendar") — only the home dashboard carries the family
  // brand.
  pageTitle: string;
};

export const PWA_APPS: PwaApp[] = [
  { key: "home", name: "Family HQ", shortName: "Family HQ", startUrl: "/home", pageTitle: "Mason Family HQ" },
  { key: "family", name: "Family", shortName: "Family", startUrl: "/family", pageTitle: "Family" },
  { key: "todos", name: "Todos", shortName: "Todos", startUrl: "/todos", pageTitle: "Todos" },
  { key: "reader", name: "Reader", shortName: "Reader", startUrl: "/reader", pageTitle: "Reader" },
  { key: "journal", name: "Journal", shortName: "Journal", startUrl: "/journal", pageTitle: "Journal" },
  { key: "bucks", name: "Mason Bucks", shortName: "Bucks", startUrl: "/bucks", pageTitle: "Mason Bucks" },
  { key: "timeline", name: "Timeline", shortName: "Timeline", startUrl: "/timeline", pageTitle: "Timeline" },
  { key: "calendar", name: "Calendar", shortName: "Calendar", startUrl: "/calendar", pageTitle: "Calendar" },
  { key: "assignments", name: "Assignments", shortName: "Assignments", startUrl: "/assignments", pageTitle: "Assignments" },
  { key: "workouts", name: "Workouts", shortName: "Workouts", startUrl: "/workouts", pageTitle: "Workouts" },
  { key: "practice", name: "Practice Log", shortName: "Practice", startUrl: "/practice", pageTitle: "Practice Log" },
  { key: "baseball", name: "Baseball", shortName: "Baseball", startUrl: "/baseball", pageTitle: "Baseball" },
];

const byKey = new Map(PWA_APPS.map((app) => [app.key, app]));

export function getPwaApp(key: string): PwaApp | undefined {
  return byKey.get(key);
}

// Resolve which app a pathname belongs to by its top-level route prefix
// (e.g. "/practice/repertoire/abc" → the "practice" app). The `/` guard keeps
// "/home" from matching "/homework".
export function getPwaAppByPath(pathname: string): PwaApp | undefined {
  return PWA_APPS.find(
    (app) => pathname === app.startUrl || pathname.startsWith(`${app.startUrl}/`)
  );
}

// localStorage key (dev only) for the last app you were in, so the root `/`
// can send you straight back there. Read by DevRootRedirect, written by
// LastAppTracker.
export const LAST_APP_STORAGE_KEY = "hq:last-app";

// iOS launch screens. A standalone web app launches to plain white unless an
// apple-touch-startup-image whose pixel size exactly matches the device is
// linked (iOS ignores the manifest's background_color for this), so we list
// one image per device size and let the media query pick the match. Sizes are
// CSS points + device pixel ratio, portrait only (the manifest pins portrait).
// Covers iPhone 8/SE through 17 Pro Max plus the common iPads. The images are
// drawn by scripts/generate-icons.mjs into public/app-splash/ — keep its
// mirror of this list in sync.
export const SPLASH_SIZES = [
  // iPhones
  { w: 440, h: 956, r: 3 }, // 16/17 Pro Max
  { w: 430, h: 932, r: 3 }, // 14 Pro Max, 15 Pro Max/Plus, 16 Plus
  { w: 428, h: 926, r: 3 }, // 12/13 Pro Max, 14 Plus
  { w: 414, h: 896, r: 3 }, // XS Max, 11 Pro Max
  { w: 414, h: 896, r: 2 }, // XR, 11
  { w: 402, h: 874, r: 3 }, // 16 Pro, 17, 17 Pro
  { w: 393, h: 852, r: 3 }, // 14 Pro, 15, 15 Pro, 16, 16e
  { w: 390, h: 844, r: 3 }, // 12, 12 Pro, 13, 13 Pro, 14
  { w: 375, h: 812, r: 3 }, // X, XS, 11 Pro, 12/13 mini
  { w: 375, h: 667, r: 2 }, // 6/7/8, SE 2/3
  // iPads
  { w: 1024, h: 1366, r: 2 }, // iPad Pro 12.9"
  { w: 834, h: 1194, r: 2 }, // iPad Pro 11"
  { w: 820, h: 1180, r: 2 }, // iPad Air 10.9", iPad 10th gen
  { w: 810, h: 1080, r: 2 }, // iPad 10.2"
  { w: 768, h: 1024, r: 2 }, // iPad 9.7", mini 5
  { w: 744, h: 1133, r: 2 }, // iPad mini 6/7
];

export function appleStartupImages(key: string) {
  return SPLASH_SIZES.map(({ w, h, r }) => ({
    url: `/app-splash/${key}-${w * r}x${h * r}.png`,
    media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
  }));
}

// Metadata for a route group's layout: gives this section its own home-screen
// name and points the manifest link at its per-app manifest. Each app titles
// itself like a standalone product: `absolute` escapes the root layout's
// "%s · Mason Family HQ" template so the tab reads just "Todos", and the app's
// own template suffixes its subpages ("Snoozed · Todos"). We re-state
// appleWebApp.capable/statusBarStyle because a child's appleWebApp replaces
// the root's wholesale rather than merging field-by-field.
export function appMetadata(key: string): Metadata {
  const app = getPwaApp(key);
  if (!app) return {};
  return {
    title: {
      absolute: app.pageTitle,
      template: `%s · ${app.pageTitle}`,
    },
    applicationName: app.name,
    appleWebApp: {
      capable: true,
      title: app.name,
      statusBarStyle: "default",
      startupImage: appleStartupImages(app.key),
    },
    manifest: `/app-manifest?app=${app.key}`,
  };
}
