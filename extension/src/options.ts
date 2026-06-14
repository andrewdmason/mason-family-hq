/// <reference types="chrome" />

// Options page: persist the reader's base URL + personal API token to
// chrome.storage.sync so the background worker can authenticate its POSTs.

const baseUrlInput = document.getElementById("baseUrl") as HTMLInputElement;
const tokenInput = document.getElementById("token") as HTMLInputElement;
const saveButton = document.getElementById("save") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLSpanElement;

async function load(): Promise<void> {
  const { baseUrl, token } = await chrome.storage.sync.get(["baseUrl", "token"]);
  if (typeof baseUrl === "string") baseUrlInput.value = baseUrl;
  if (typeof token === "string") tokenInput.value = token;
}

/**
 * Accept a bare host (e.g. "localhost:3000" or "reader.example.com") and add a
 * sensible scheme — http for localhost, https otherwise — so a missing scheme
 * doesn't produce `URL scheme "localhost" is not supported` at fetch time.
 */
function normalizeBaseUrl(raw: string): string {
  let v = raw.trim().replace(/\/+$/, "");
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) {
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(v);
    v = (isLocal ? "http://" : "https://") + v;
  }
  return v;
}

async function save(): Promise<void> {
  const baseUrl = normalizeBaseUrl(baseUrlInput.value);
  const token = tokenInput.value.trim();
  await chrome.storage.sync.set({ baseUrl, token });
  baseUrlInput.value = baseUrl; // reflect the normalized value back
  status.textContent = "Saved";
  setTimeout(() => {
    status.textContent = "";
  }, 1500);
}

saveButton.addEventListener("click", () => void save());
void load();
