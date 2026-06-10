# Apple Reminders → Todos import (iOS Shortcut)

Siri capture ("Hey Siri, remind me to buy stamps") lands in Apple Reminders.
There's no server-side API for iCloud Reminders, so a Shortcut on your iPhone
sweeps the default Reminders list into the Todos Inbox and deletes what it
imported. Run it on a schedule with a personal automation; the `external_id`
dedupe makes re-runs (and a crash between import and delete) harmless.

## One-time setup

1. In the web app, open **Todos → Integrations** (`/todos/settings`) and
   create a token named **iOS Shortcut**. Copy it — it's shown once.
2. On the iPhone, open **Shortcuts** and create a new shortcut named
   **Sweep Reminders to Todos**.

## Shortcut actions, in order

1. **Find Reminders** — set the filters to:
   - List: **Reminders** (your default list)
   - Is Completed: **No**
   - (Leave "Limit" off)
   The result variable is **Reminders**.
2. **If** — Input: **Reminders** · Condition: **has any value**. (Put
   everything below inside the If; add nothing to Otherwise.)
3. **Repeat with Each** — Input: **Reminders**. Inside the repeat:
   1. **Text** — content (this is the dedupe key; iOS exposes no stable
      reminder id to Shortcuts, so title + creation date is the next best
      thing):
      ```
      Repeat Item [Name] @ Repeat Item [Creation Date]
      ```
      Insert both as magic variables with those property selections.
   2. **Get Contents of URL** — configure:
      - URL: `https://<your-host>/api/todo/ingest`
      - Method: **POST**
      - Headers:
        - `Authorization`: `Bearer <token from step 1>`
        - `Content-Type`: `application/json`
      - Request Body: **JSON**, shaped as:
        ```json
        {
          "items": [
            {
              "title": "<Repeat Item · Name>",
              "notes": "<Repeat Item · Notes>",
              "external_id": "<Text>",
              "source": "reminders"
            }
          ]
        }
        ```
        (Easiest path: choose Request Body → File, then a **Text** action
        above it holding the JSON with magic variables inlined — or build the
        dictionary with nested Dictionary actions; both work.)
   3. **Get Dictionary from Input** — Input: **Contents of URL**.
   4. **Get Dictionary Value** — Get **Value** for key `items.1.status`.
   5. **If** — Input: **Dictionary Value** · Condition: **is** `created`
      — *or* `duplicate`. Shortcuts can't OR two conditions in one If, so
      use: Condition **is not** `error`. Inside:
      - **Remove Reminders** — Input: **Repeat Item**. (The first run will
        ask to allow deleting without confirmation — allow it, or the
        automation will stall waiting for a tap.)
4. (Optional, after the repeat) **Show Notification** — "Imported
   *Repeat Results count* reminders".

## Automation

In Shortcuts → **Automation** → **+** → **Time of Day** → pick a cadence
(e.g. 8:00, 13:00, 19:00 — automations can't run "every hour" directly; add
a few time triggers, or use the **Charger** trigger as a bonus sweep). Set
**Run Immediately** (no confirmation) and attach the shortcut.

Notes:

- The sweep only touches the **default** list, so shared/project lists in
  Reminders are left alone.
- Deletion happens only after the server confirms `created` or `duplicate`,
  so a failed request never loses a reminder.
- Tasks land in your Todos **Inbox**, with the reminder's notes carried over.
