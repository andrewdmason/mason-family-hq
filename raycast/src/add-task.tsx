import {
  Action,
  ActionPanel,
  Form,
  Toast,
  getPreferenceValues,
  popToRoot,
  showToast,
} from "@raycast/api";
import { useEffect, useMemo, useState } from "react";

/**
 * Quick capture: hotkey → type → Enter → it's in the Inbox. The assignee
 * dropdown covers the "throw laundry on Jenny's list" case; the project
 * dropdown narrows to projects the chosen assignee belongs to (the app's
 * membership rule). Talks to POST /api/todo/ingest with a personal token.
 */

type Preferences = {
  apiUrl: string;
  apiToken: string;
};

type Meta = {
  members: { email: string; name: string | null }[];
  projects: { id: string; name: string; member_emails: string[] }[];
};

export default function AddTask() {
  const { apiUrl, apiToken } = getPreferenceValues<Preferences>();
  const baseUrl = apiUrl.replace(/\/+$/, "");

  const [meta, setMeta] = useState<Meta | null>(null);
  const [assignee, setAssignee] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${baseUrl}/api/todo/ingest`, {
          headers: { Authorization: `Bearer ${apiToken}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Meta;
        if (!cancelled) setMeta(data);
      } catch (error) {
        if (!cancelled) {
          await showToast({
            style: Toast.Style.Failure,
            title: "Couldn't load family members",
            message: error instanceof Error ? error.message : String(error),
          });
          setMeta({ members: [], projects: [] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, apiToken]);

  const projects = useMemo(() => {
    if (!meta) return [];
    if (!assignee) return meta.projects;
    return meta.projects.filter((p) => p.member_emails.includes(assignee));
  }, [meta, assignee]);

  async function submit(values: {
    title: string;
    notes: string;
    assignee: string;
    project: string;
  }) {
    const title = values.title.trim();
    if (!title) {
      await showToast({ style: Toast.Style.Failure, title: "Title is required" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${baseUrl}/api/todo/ingest`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [
            {
              title,
              notes: values.notes.trim() || undefined,
              assignee_email: values.assignee || undefined,
              project_id: values.project || undefined,
              source: "raycast",
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        items: { status: string; error?: string }[];
      };
      const result = body.items[0];
      if (result?.status !== "created") {
        throw new Error(result?.error ?? "Unexpected response");
      }
      await showToast({ style: Toast.Style.Success, title: "Added to Inbox" });
      await popToRoot();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Couldn't add to-do",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Form
      isLoading={meta === null || submitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Add To-Do" onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="To-Do" placeholder="What needs doing?" autoFocus />
      <Form.Dropdown
        id="assignee"
        title="For"
        value={assignee}
        onChange={setAssignee}
      >
        <Form.Dropdown.Item value="" title="Me" />
        {(meta?.members ?? []).map((member) => (
          <Form.Dropdown.Item
            key={member.email}
            value={member.email}
            title={member.name ?? member.email}
          />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="project" title="Project">
        <Form.Dropdown.Item value="" title="None (Inbox)" />
        {projects.map((project) => (
          <Form.Dropdown.Item key={project.id} value={project.id} title={project.name} />
        ))}
      </Form.Dropdown>
      <Form.TextArea id="notes" title="Notes" placeholder="Optional details" />
    </Form>
  );
}
