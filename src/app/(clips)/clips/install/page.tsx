import { buttonVariants } from "@/components/ui/button-variants";
import { supabaseUrl } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Install Baseball Clips" };

// The install link for the Clips Camera iPhone app — public, so it can be
// texted to anyone — for family phones that
// can't use TestFlight (Apple won't let under-13 accounts test). The publish
// script drops each build in the public app-builds bucket with a manifest and
// a latest.json pointer; iOS installs from the manifest when the link is tapped
// in Safari — but only on iPhones registered on the family developer account.

type Latest = { version: string; build: string; publishedAt: string; manifest: string };

async function latestBuild(): Promise<Latest | null> {
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/public/app-builds/clips-camera/latest.json`, {
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as Latest) : null;
  } catch {
    return null;
  }
}

export default async function InstallClipsCameraPage() {
  const latest = await latestBuild();
  const href = latest ? `itms-services://?action=download-manifest&url=${encodeURIComponent(latest.manifest)}` : null;
  const published = latest
    ? new Date(latest.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8 sm:px-6">
      <h1 className="font-serif text-2xl tracking-tight text-foreground">Baseball Clips for iPhone</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Film at-bats, tap each pitch, and they land here in Clips.
      </p>

      {href ? (
        <>
          <a href={href} className={buttonVariants({ size: "lg", className: "mt-6 w-full" })}>
            Install Baseball Clips
          </a>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Version {latest!.version} · updated {published}
          </p>
        </>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">No build has been published yet.</p>
      )}

      <ol className="mt-8 list-decimal space-y-2 pl-5 text-sm text-foreground">
        <li>Open this page in Safari on your iPhone.</li>
        <li>
          Tap <strong>Install Baseball Clips</strong>, then <strong>Install</strong> when your iPhone asks.
        </li>
        <li>Go to your home screen and wait for the app to finish installing.</li>
        <li>Open it and sign in with your Family HQ Google account.</li>
      </ol>
      <p className="mt-6 text-sm text-muted-foreground">
        To update, come back and tap Install again — your at-bats and settings stay. It only installs on iPhones
        that Dad has registered; if it says it can&apos;t be installed, that&apos;s why.
      </p>
    </main>
  );
}
