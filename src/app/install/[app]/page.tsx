import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button-variants";
import { supabaseUrl } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

// Install links for the family iPhone apps, for phones that can't use
// TestFlight (Apple won't let under-13 accounts test). ios/scripts/release.sh
// drops each ad hoc build in the public app-builds bucket with a manifest and a
// latest.json pointer; iOS installs from the manifest when the link is tapped
// in Safari, but only on iPhones registered on the family developer account.
// Public, so it can be texted. Once installed, the app shows its own update
// banner for each new build (MasonKit's AppUpdate).

const APPS: Record<string, { name: string; blurb: string; keeps: string }> = {
  tuttles: {
    name: "Tuttles",
    blurb: "Your homework tutor. Snap a picture of the problem and work it out together.",
    keeps: "your chats",
  },
};

type Latest = { version: string; build: string; publishedAt: string; manifest: string };

async function latestBuild(slug: string): Promise<Latest | null> {
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/public/app-builds/${slug}/latest.json`, {
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as Latest) : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ app: string }> }) {
  const app = APPS[(await params).app];
  return { title: app ? `Install ${app.name}` : "Install" };
}

export default async function InstallAppPage({ params }: { params: Promise<{ app: string }> }) {
  const slug = (await params).app;
  const app = APPS[slug];
  if (!app) notFound();

  const latest = await latestBuild(slug);
  const href = latest ? `itms-services://?action=download-manifest&url=${encodeURIComponent(latest.manifest)}` : null;
  const published = latest
    ? new Date(latest.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8 sm:px-6">
      <h1 className="font-serif text-2xl tracking-tight text-foreground">{app.name} for iPhone</h1>
      <p className="mt-1 text-sm text-muted-foreground">{app.blurb}</p>

      {href ? (
        <>
          <a href={href} className={buttonVariants({ size: "lg", className: "mt-6 w-full" })}>
            Install {app.name}
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
          Tap <strong>Install {app.name}</strong>, then <strong>Install</strong> when your iPhone asks.
        </li>
        <li>Go to your home screen and wait for the app to finish installing.</li>
        <li>Open it and sign in with your Family HQ Google account.</li>
      </ol>
      <p className="mt-6 text-sm text-muted-foreground">
        When there&apos;s a new version, the app shows a banner at the top; tap it to update ({app.keeps} stay). It
        only installs on iPhones that Dad has registered; if it says it can&apos;t be installed, that&apos;s why.
      </p>
    </main>
  );
}
