/// <reference types="chrome" />

import { extractArticle, type ExtractedArticle } from "./extract";

// MV3 service worker. On toolbar click: inject the bundled libs, extract the
// readable article from the live page (so paywalled/logged-in content comes
// through), and POST it to the configured Mason reader. Feedback is shown via
// the action badge — never a blocking dialog.

type Config = { baseUrl: string; token: string };

// Add a scheme if the stored URL lacks one (http for localhost, https
// otherwise) — older saves stored a bare host, which fetch rejects with
// `URL scheme "localhost" is not supported`.
function normalizeBaseUrl(raw: string): string {
  let v = raw.trim().replace(/\/+$/, "");
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) {
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(v);
    v = (isLocal ? "http://" : "https://") + v;
  }
  return v;
}

async function getConfig(): Promise<Config | null> {
  const { baseUrl, token } = await chrome.storage.sync.get(["baseUrl", "token"]);
  if (typeof baseUrl !== "string" || typeof token !== "string") return null;
  if (!baseUrl.trim() || !token.trim()) return null;
  return { baseUrl: normalizeBaseUrl(baseUrl), token: token.trim() };
}

function setBadge(tabId: number, text: string, color: string): void {
  void chrome.action.setBadgeText({ tabId, text });
  void chrome.action.setBadgeBackgroundColor({ tabId, color });
}

function clearBadgeSoon(tabId: number): void {
  setTimeout(() => {
    void chrome.action.setBadgeText({ tabId, text: "" });
  }, 4000);
}

async function saveActiveTab(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) return;
  const tabId = tab.id;

  const config = await getConfig();
  if (!config) {
    setBadge(tabId, "?", "#9ca3af");
    clearBadgeSoon(tabId);
    void chrome.runtime.openOptionsPage();
    return;
  }

  try {
    // Load Readability + DOMPurify into the page, then extract.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["vendor.js"],
    });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractArticle,
    });
    const article = injection?.result as ExtractedArticle | null | undefined;
    if (!article || !article.content) {
      throw new Error("No readable article found on this page.");
    }

    const res = await fetch(`${config.baseUrl}/api/reading/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        url: article.url,
        title: article.title,
        author: article.byline,
        siteName: article.siteName,
        excerpt: article.excerpt,
        coverImageUrl: article.leadImageUrl,
        html: article.content,
      }),
    });
    if (!res.ok) throw new Error(`Save failed (${res.status}).`);

    setBadge(tabId, "✓", "#16a34a");
  } catch {
    setBadge(tabId, "!", "#dc2626");
  } finally {
    clearBadgeSoon(tabId);
  }
}

chrome.action.onClicked.addListener((tab) => {
  void saveActiveTab(tab);
});
