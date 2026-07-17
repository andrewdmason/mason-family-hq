# Mason Reader — Chrome extension

Save the article you're reading straight into your Mason reader. Capture runs
against the **live, rendered page** (using your logged-in session), so paywalled
and JS-heavy articles come through intact. The article is extracted with Mozilla
Readability, cleaned with DOMPurify, and POSTed to `/api/reading/ingest`, which
re-sanitizes it server-side before storing.

## Durable install (force-install, no Web Store)

This extension is **self-hosted and force-installed** via Chrome enterprise
policy, so it survives restarts/updates and never triggers the "disable
developer-mode extensions" nag. The signed CRX3 + Omaha update manifest are
served from the app itself at `family.mason.io/extension/`.

- **Permanent extension ID:** `emfkmmdfholekpbaefchdpgflifjemja`
  (derived from `extension/key.pem`; pinned into `manifest.json` via `"key"`).
- **Signing key** `extension/key.pem` is **gitignored and irreplaceable** —
  losing it means a new ID and a wiped `chrome.storage` (App URL + token).
  **Back it up to 1Password** and never regenerate it.

### One-time install on a Mac

After the CRX + `updates.xml` are live on `family.mason.io` (i.e. merged to
`main` and deployed):

```bash
defaults write com.google.Chrome ExtensionInstallForcelist -array \
  "emfkmmdfholekpbaefchdpgflifjemja;https://family.mason.io/extension/updates.xml"
killall cfprefsd            # flush the prefs cache
# then fully quit Chrome (Cmd-Q) and relaunch
```

Verify at `chrome://policy` (Reload policies → `ExtensionInstallForcelist`,
Source **Platform**, Status OK). Within a minute the extension appears in
`chrome://extensions` as "Installed by your administrator". Remove any old
load-unpacked copy (same ID, so it's superseded).

To **uninstall** the policy: `defaults delete com.google.Chrome ExtensionInstallForcelist && killall cfprefsd`, then relaunch Chrome.

### Configure it

Click the toolbar button once → the options page opens. Set:
- **App URL** — the reader's origin (`https://family.mason.io`).
- **API token** — generate one in the reader under **Settings → Reader settings**.

Because the ID is now stable and config lives in `chrome.storage.sync`, these
settings persist across reinstalls and sync to your Google account.

## Release a new version

The version in `manifest.json` is the single source of truth — Chrome only pulls
a new CRX when `updates.xml` advertises a **higher** version.

```bash
cd extension
# 1. bump "version" in manifest.json (and package.json to match, for tidiness)
npm run release    # build.mjs → dist/, then pack.mjs → public/extension/{mason-reader.crx,updates.xml}
# 2. commit the regenerated public/extension/* and push; merge to main → deploy
```

Chrome auto-updates within its normal poll window (~5h), or immediately via
`chrome://extensions` → Developer mode → **Update**, or a Chrome restart.

## Local dev (load unpacked)

For iterating without a release: `npm run build`, then `chrome://extensions` →
Developer mode → **Load unpacked** → select `extension/dist`. The `"key"` in the
manifest means the unpacked load shares the same ID (and storage) as the
force-installed build.

## Use

Click the toolbar button on any article. The badge shows:

- **✓** saved (created or updated — re-saving the same URL updates in place)
- **!** something went wrong (no readable article, or the save failed)
- **?** not configured yet (opens the options page)

The saved article appears in your reader's list (filter by **Articles**) and
opens in the same reader as your books.

## Notes

- The endpoint allows cross-origin requests only from `chrome-extension://`
  origins; no host permissions are requested — it relies on the server's CORS.
- Not a Web Store listing — it's a self-hosted, policy-force-installed extension.
- `src/middleware.ts` excludes `/extension/` from the auth gate so Chrome's
  (unauthenticated) updater can fetch the CRX + `updates.xml` without being
  redirected to `/login`.
