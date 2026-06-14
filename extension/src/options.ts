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

async function save(): Promise<void> {
  const baseUrl = baseUrlInput.value.trim().replace(/\/+$/, "");
  const token = tokenInput.value.trim();
  await chrome.storage.sync.set({ baseUrl, token });
  status.textContent = "Saved";
  setTimeout(() => {
    status.textContent = "";
  }, 1500);
}

saveButton.addEventListener("click", () => void save());
void load();
