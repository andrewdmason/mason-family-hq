"use client";

import {
  AppOrigin,
  CodeBlock,
  InlineCode,
  RecipeModal,
  Section,
} from "@/components/todos/recipe-modal";

/**
 * The Raycast quick-capture setup, rendered in-app. The extension itself
 * lives in the repo at raycast/ — private, never published to the store.
 */
export function RaycastRecipeModal() {
  return (
    <RecipeModal linkText="the Raycast setup" title="Raycast quick-capture">
      <p className="text-muted-foreground">
        A private Raycast extension for the Mac: hotkey → type → Enter and the
        to-do is in the Inbox. It lives in the repo at{" "}
        <InlineCode>raycast/</InlineCode> and is installed locally — never
        published to the Raycast store.
      </p>

      <Section title="Install">
        <p>From a checkout of the repo:</p>
        <CodeBlock>{`cd raycast
npm install
npm run dev   # \`ray develop\` — registers the extension and hot-reloads`}</CodeBlock>
        <p>
          After the first <InlineCode>npm run dev</InlineCode>, the extension
          stays installed in Raycast (it appears as{" "}
          <strong>Family Todos</strong>); you can stop the dev process.
        </p>
      </Section>

      <Section title="Configure">
        <p>
          In Raycast → <strong>Extensions</strong> →{" "}
          <strong>Family Todos</strong>, fill in the two preferences:
        </p>
        <ul className="mt-1 list-disc space-y-1.5 pl-5">
          <li>
            <strong>Family HQ URL</strong> — the deployment base URL, no
            trailing slash: <AppOrigin />
          </li>
          <li>
            <strong>API Token</strong> — create one on this page named{" "}
            <strong>Raycast</strong>. Copy it — it&rsquo;s shown once.
          </li>
        </ul>
      </Section>

      <Section title="Use it">
        <p>
          Bind a hotkey to the <strong>Add To-Do</strong> command. Title +
          Enter drops the task in your Inbox; the <strong>For</strong>{" "}
          dropdown reassigns it to another family member, and the{" "}
          <strong>Project</strong> dropdown files it into a project (only
          projects that person belongs to are offered).
        </p>
      </Section>
    </RecipeModal>
  );
}
