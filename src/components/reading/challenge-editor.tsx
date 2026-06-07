"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  createChallenge,
  setChallengeStatus,
  updateChallenge,
} from "@/app/(reading)/reader/challenges/actions";
import { challengesHref } from "@/lib/reading/links";
import type { ReadingChallenge } from "@/lib/types";

function getMarkdown(editor: Editor): string {
  const md = (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown;
  return md?.getMarkdown?.() ?? "";
}

type KidOption = { email: string; name: string | null };

export function ChallengeEditor({
  mode,
  challenge,
  kids = [],
}: {
  mode: "create" | "edit";
  challenge?: ReadingChallenge;
  /** Selectable kids (create mode only). */
  kids?: KidOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kidEmail, setKidEmail] = useState(challenge?.kid_email ?? kids[0]?.email ?? "");
  const [title, setTitle] = useState(challenge?.title ?? "");
  const [startDate, setStartDate] = useState(challenge?.start_date ?? "");
  const [endDate, setEndDate] = useState(challenge?.end_date ?? "");
  const [pageGoal, setPageGoal] = useState(
    challenge?.page_goal != null ? String(challenge.page_goal) : "",
  );
  const [pagesPerToken, setPagesPerToken] = useState(
    String(challenge?.pages_per_token ?? 30),
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({
        placeholder: "Describe the prizes, tiers, and rules…",
      }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: "-",
        linkify: true,
        breaks: false,
      }),
    ],
    content: challenge?.description ?? "",
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "prose-editor font-serif text-base focus:outline-none" },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const description = editor ? getMarkdown(editor) : "";
    const goalNum = Number(pageGoal);
    const tokenNum = Number(pagesPerToken);

    startTransition(async () => {
      try {
        if (mode === "create") {
          const { id } = await createChallenge({
            kidEmail,
            title,
            description,
            startDate,
            endDate,
            pageGoal: goalNum,
            pagesPerToken: tokenNum,
          });
          router.push(`/reader/challenges/${id}/edit`);
          router.refresh();
        } else if (challenge) {
          await updateChallenge(challenge.id, {
            title,
            description,
            startDate,
            endDate,
            pageGoal: goalNum,
            pagesPerToken: tokenNum,
          });
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function handleStatus(status: "active" | "archived") {
    if (!challenge) return;
    setError(null);
    startTransition(async () => {
      try {
        await setChallengeStatus(challenge.id, status);
        if (status === "archived") {
          router.push(challengesHref());
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  const kidLabel =
    kids.find((k) => k.email === kidEmail)?.name ?? challenge?.kid_email ?? kidEmail;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Reader</Label>
          {mode === "create" ? (
            <Select value={kidEmail} onValueChange={(v) => setKidEmail(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a kid" />
              </SelectTrigger>
              <SelectContent>
                {kids.map((k) => (
                  <SelectItem key={k.email} value={k.email}>
                    {k.name ?? k.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
              {kidLabel}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Summer Reading Challenge"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="start">Start date</Label>
          <Input
            id="start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="end">End date</Label>
          <Input
            id="end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="goal">Page goal</Label>
          <Input
            id="goal"
            type="number"
            min={1}
            value={pageGoal}
            onChange={(e) => setPageGoal(e.target.value)}
            placeholder="1000"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="token">Pages per token</Label>
          <Input
            id="token"
            type="number"
            min={0}
            value={pagesPerToken}
            onChange={(e) => setPagesPerToken(e.target.value)}
            placeholder="30"
          />
          <p className="text-xs text-muted-foreground">0 turns tokens off.</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Prizes &amp; rules</Label>
        <EditorToolbar editor={editor} />
        <div className="agent-editor rounded-md border border-border bg-card p-4">
          <EditorContent editor={editor} />
        </div>
        <p className="text-xs text-muted-foreground">
          Free-form — tiers, weekly bonuses, anything. The reader sees this on their
          challenge page.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Create challenge" : "Save changes"}
        </Button>
        {mode === "edit" && challenge && (
          <div className="flex items-center gap-2">
            {challenge.status === "active" ? (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => handleStatus("archived")}
              >
                Archive
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => handleStatus("active")}
              >
                Reactivate
              </Button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}

function EditorToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div className="h-9" />;
  const btn = (
    active: boolean,
    onClick: () => void,
    label: string,
    icon: React.ReactNode,
  ) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded transition-colors",
        active
          ? "bg-foreground/10 text-foreground"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      {icon}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-1">
      {btn(
        editor.isActive("heading", { level: 2 }),
        () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        "Heading",
        <Heading2 className="h-4 w-4" />,
      )}
      {btn(
        editor.isActive("heading", { level: 3 }),
        () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        "Subheading",
        <Heading3 className="h-4 w-4" />,
      )}
      <span className="mx-1 h-4 w-px bg-border" />
      {btn(
        editor.isActive("bold"),
        () => editor.chain().focus().toggleBold().run(),
        "Bold",
        <Bold className="h-4 w-4" />,
      )}
      {btn(
        editor.isActive("italic"),
        () => editor.chain().focus().toggleItalic().run(),
        "Italic",
        <Italic className="h-4 w-4" />,
      )}
      <span className="mx-1 h-4 w-px bg-border" />
      {btn(
        editor.isActive("bulletList"),
        () => editor.chain().focus().toggleBulletList().run(),
        "Bullet list",
        <List className="h-4 w-4" />,
      )}
      {btn(
        editor.isActive("orderedList"),
        () => editor.chain().focus().toggleOrderedList().run(),
        "Numbered list",
        <ListOrdered className="h-4 w-4" />,
      )}
      {btn(
        editor.isActive("blockquote"),
        () => editor.chain().focus().toggleBlockquote().run(),
        "Quote",
        <Quote className="h-4 w-4" />,
      )}
    </div>
  );
}
