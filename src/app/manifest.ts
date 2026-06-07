import type { MetadataRoute } from "next";

// The web app manifest — what makes Mason Family HQ installable to the iPhone
// home screen and launchable as a standalone app (no Safari chrome). The theme
// and background colours match the warm cream/terracotta palette so the splash
// and status bar feel native. Served at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mason Family HQ",
    short_name: "Family HQ",
    description: "The Mason family's private home base",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf7f0",
    theme_color: "#7f4327",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
