import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Lora } from "next/font/google";
import { GlobalQuickAdd } from "@/components/todos/global-quick-add";
import { LastAppTracker } from "@/components/layout/last-app-tracker";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { appleStartupImages } from "@/lib/pwa/apps";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Apps title themselves like standalone products: each route group's layout
  // sets an absolute title ("Todos", "Calendar") plus its own subpage template
  // ("Snoozed · Todos") via appMetadata() — see src/lib/pwa/apps.ts. This root
  // template only reaches pages outside an app group (e.g. /login), and the
  // default covers pages with no title at all.
  title: {
    default: "Mason Family HQ",
    template: "%s · Mason Family HQ",
  },
  description: "The Mason family's private home base",
  applicationName: "Mason Family HQ",
  // Makes the iPhone home-screen launch run standalone (no Safari chrome) with
  // a translucent status bar, the right home-screen label, and a cream launch
  // screen instead of iOS's default white flash. Each app's layout overrides
  // this wholesale with its own title + splash set — see src/lib/pwa/apps.ts.
  appleWebApp: {
    capable: true,
    title: "Family HQ",
    statusBarStyle: "default",
    startupImage: appleStartupImages("home"),
  },
  // The default manifest (used on routes outside a route group, e.g. /login).
  // Each app's own layout overrides this with its per-app manifest so installs
  // get that section's name, start URL, and icon. See src/lib/pwa/apps.ts.
  manifest: "/app-manifest?app=home",
  // Next emits the modern `mobile-web-app-capable`; older iOS still looks for the
  // apple-prefixed tag, so set it too for maximum standalone compatibility.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  // A private family app — keep it out of search indexes.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Cover the notch/safe areas so standalone mode fills the screen, and pin the
  // browser/status-bar tint to the warm terracotta theme.
  width: "device-width",
  initialScale: 1,
  // iOS auto-zooms the page when a focused input's font-size is under 16px,
  // which leaves a standalone PWA cropped/panned with no pinch-out chrome to
  // recover. maximum-scale=1 suppresses that focus zoom; since iOS 10 Safari
  // still honours user-initiated pinch zoom regardless, so accessibility zoom
  // keeps working.
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#7f4327",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        {/* Global to-do quick-add: press `c` anywhere (see quick-add.tsx). */}
        <GlobalQuickAdd />
        {/* Dev-only: remember the last app you were in so `/` returns there. */}
        {process.env.NODE_ENV === "development" && <LastAppTracker />}
        {/* Caches the app shell so re-launching the PWA paints instantly. */}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
