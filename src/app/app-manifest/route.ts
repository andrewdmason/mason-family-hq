import { getPwaApp } from "@/lib/pwa/apps";

// Per-app web manifest. Android/desktop installs read the manifest (not the
// apple-* meta tags iOS uses), so each section links its own copy via
// ?app=<key> — see appMetadata(). The icons and name come from the shared
// registry so this stays in lockstep with the home-screen identity and the
// generated icon art. Served public (excluded from auth middleware) so the
// browser can fetch it before sign-in.
export function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("app") ?? "home";
  const app = getPwaApp(key) ?? getPwaApp("home")!;

  const manifest = {
    name: app.name,
    short_name: app.shortName,
    description: "The Mason family's private home base",
    start_url: app.startUrl,
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf7f0",
    theme_color: "#7f4327",
    icons: [
      { src: `/app-icons/${app.key}-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/app-icons/${app.key}-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/app-icons/${app.key}-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
