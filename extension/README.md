# Mason Reader — Chrome extension

Save the article you're reading straight into your Mason reader. Capture runs
against the **live, rendered page** (using your logged-in session), so paywalled
and JS-heavy articles come through intact. The article is extracted with Mozilla
Readability, cleaned with DOMPurify, and POSTed to `/api/reading/ingest`, which
re-sanitizes it server-side before storing.

## Build

```bash
cd extension
npm install
npm run build      # outputs dist/
```

## Load it

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select `extension/dist`.
3. Pin the extension. Click it once → the options page opens.
4. Set:
   - **App URL** — your reader's origin (e.g. `https://your-reader.example.com`).
   - **API token** — generate one in the reader under **Settings → Reader
     settings**, paste it here.

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
- This is an unpacked/sideloaded extension, not a Web Store listing.
