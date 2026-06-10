"use client";

import {
  AppOrigin,
  CodeBlock,
  InlineCode,
  RecipeModal,
  Section,
} from "@/components/todos/recipe-modal";

/**
 * The iOS Reminders → Todos Shortcut recipe, rendered in-app instead of
 * living as a markdown doc. Triggered by an inline link on the Integrations
 * settings page.
 */
export function ShortcutRecipeModal() {
  return (
    <RecipeModal linkText="the Shortcut recipe" title="Apple Reminders → Todos">
      <p className="text-muted-foreground">
        Siri capture (&ldquo;Hey Siri, remind me to buy stamps&rdquo;) lands in
        Apple Reminders. There&rsquo;s no server-side API for iCloud Reminders,
        so a Shortcut on your iPhone sweeps the default Reminders list into the
        Todos Inbox and deletes what it imported. Run it on a schedule with a
        personal automation; the <InlineCode>external_id</InlineCode> dedupe
        makes re-runs (and a crash between import and delete) harmless.
      </p>

      <Section title="One-time setup">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            On this page, create a token named <strong>iOS Shortcut</strong>.
            Copy it — it&rsquo;s shown once.
          </li>
          <li>
            On the iPhone, open <strong>Shortcuts</strong> and create a new
            shortcut named <strong>Sweep Reminders to Todos</strong>.
          </li>
        </ol>
      </Section>

      <Section title="Shortcut actions, in order">
        <ol className="list-decimal space-y-2.5 pl-5">
          <li>
            <strong>Find Reminders</strong> — set the filters to:
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                List: <strong>Reminders</strong> (your default list)
              </li>
              <li>
                Is Completed: <strong>No</strong>
              </li>
              <li>(Leave &ldquo;Limit&rdquo; off)</li>
            </ul>
            The result variable is <strong>Reminders</strong>.
          </li>
          <li>
            <strong>If</strong> — Input: <strong>Reminders</strong> ·
            Condition: <strong>has any value</strong>. (Put everything below
            inside the If; add nothing to Otherwise.)
          </li>
          <li>
            <strong>Repeat with Each</strong> — Input:{" "}
            <strong>Reminders</strong>. Inside the repeat:
            <ol className="mt-1 list-decimal space-y-2 pl-5">
              <li>
                <strong>Text</strong> — content (this is the dedupe key; iOS
                exposes no stable reminder id to Shortcuts, so title + creation
                date is the next best thing):
                <CodeBlock>
                  Repeat Item [Name] @ Repeat Item [Creation Date]
                </CodeBlock>
                Insert both as magic variables with those property selections.
              </li>
              <li>
                <strong>Get Contents of URL</strong> — configure:
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  <li>
                    URL: <AppOrigin suffix="/api/todo/ingest" />
                  </li>
                  <li>
                    Method: <strong>POST</strong>
                  </li>
                  <li>
                    Headers:
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      <li>
                        <InlineCode>Authorization</InlineCode>:{" "}
                        <InlineCode>Bearer &lt;token from setup&gt;</InlineCode>
                      </li>
                      <li>
                        <InlineCode>Content-Type</InlineCode>:{" "}
                        <InlineCode>application/json</InlineCode>
                      </li>
                    </ul>
                  </li>
                  <li>
                    Request Body: <strong>JSON</strong>, shaped as:
                    <CodeBlock>{`{
  "items": [
    {
      "title": "<Repeat Item · Name>",
      "notes": "<Repeat Item · Notes>",
      "external_id": "<Text>",
      "source": "reminders"
    }
  ]
}`}</CodeBlock>
                    (Easiest path: choose Request Body → File, then a{" "}
                    <strong>Text</strong> action above it holding the JSON with
                    magic variables inlined — or build the dictionary with
                    nested Dictionary actions; both work.)
                  </li>
                </ul>
              </li>
              <li>
                <strong>Get Dictionary from Input</strong> — Input:{" "}
                <strong>Contents of URL</strong>.
              </li>
              <li>
                <strong>Get Dictionary Value</strong> — Get{" "}
                <strong>Value</strong> for key{" "}
                <InlineCode>items.1.status</InlineCode>.
              </li>
              <li>
                <strong>If</strong> — Input: <strong>Dictionary Value</strong>{" "}
                · Condition: <strong>is</strong>{" "}
                <InlineCode>created</InlineCode> — <em>or</em>{" "}
                <InlineCode>duplicate</InlineCode>. Shortcuts can&rsquo;t OR
                two conditions in one If, so use: Condition{" "}
                <strong>is not</strong> <InlineCode>error</InlineCode>. Inside:
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  <li>
                    <strong>Remove Reminders</strong> — Input:{" "}
                    <strong>Repeat Item</strong>. (The first run will ask to
                    allow deleting without confirmation — allow it, or the
                    automation will stall waiting for a tap.)
                  </li>
                </ul>
              </li>
            </ol>
          </li>
          <li>
            (Optional, after the repeat) <strong>Show Notification</strong> —
            &ldquo;Imported <em>Repeat Results count</em>{" "}
            reminders&rdquo;.
          </li>
        </ol>
      </Section>

      <Section title="Automation">
        <p>
          In Shortcuts → <strong>Automation</strong> → <strong>+</strong> →{" "}
          <strong>Time of Day</strong> →{" "}
          pick a cadence (e.g. 8:00, 13:00, 19:00 — automations can&rsquo;t run
          &ldquo;every hour&rdquo; directly; add a few time triggers, or use
          the <strong>Charger</strong> trigger as a bonus sweep). Set{" "}
          <strong>Run Immediately</strong> (no confirmation) and attach the
          shortcut.
        </p>
      </Section>

      <Section title="Notes">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            The sweep only touches the <strong>default</strong> list, so
            shared/project lists in Reminders are left alone.
          </li>
          <li>
            Deletion happens only after the server confirms{" "}
            <InlineCode>created</InlineCode> or{" "}
            <InlineCode>duplicate</InlineCode>, so a failed request never loses
            a reminder.
          </li>
          <li>
            Tasks land in your Todos <strong>Inbox</strong>, with the
            reminder&rsquo;s notes carried over.
          </li>
        </ul>
      </Section>
    </RecipeModal>
  );
}
