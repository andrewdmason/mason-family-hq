# Family Todos — Raycast extension

Private quick-capture command for Mason Family HQ's Todos app. Not published
to the Raycast store — installed locally on Andrew's machine only.

## Install

```sh
cd raycast
npm install
npm run dev   # `ray develop` — registers the extension in Raycast and hot-reloads
```

After the first `npm run dev`, the extension stays installed in Raycast (it
appears as "Family Todos"); you can stop the dev process.

## Configure

Raycast → Extensions → Family Todos:

- **Family HQ URL** — the deployment base URL (no trailing slash).
- **API Token** — minted at Todos → Integrations (`/todos/settings`).

Then bind a hotkey to the **Add To-Do** command. Title + Enter drops the task
in your Inbox; the dropdowns reassign it to another family member or file it
into a project (only projects that person belongs to are offered).
