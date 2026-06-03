import OpenAI, { toFile } from "openai";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchTemplateId } from "@/lib/journal/seeds/interviewer-templates";
import type { JournalEntryType } from "@/lib/types";

const PHOTOS_BUCKET = "journal-photos";
const MEMBER_PHOTOS_BUCKET = "member-photos";
const IMAGE_SIZE = "1536x1024";
const PROMPT_TEXT_LIMIT = 5000;
const MAX_REFERENCE_PHOTOS = 3;
const ART_STYLES = [
  {
    name: "Cinematic film still",
    prompt:
      "A cinematic film still with expressive lighting, careful composition, rich color grading, and the feeling of a memorable scene from a movie.",
  },
  {
    name: "Surreal collage",
    prompt:
      "A dreamy mixed-media collage combining photographic fragments, painted elements, unexpected scale shifts, and a whimsical surreal mood.",
  },
  {
    name: "Spider-Verse comic",
    prompt:
      "A vibrant comic-book illustration in the style of modern animated superhero films, bold ink outlines, halftone Ben-Day dots, chromatic-aberration color offsets, dynamic angles, and a kinetic energetic feel.",
  },
  {
    name: "Graphic novel ink",
    prompt:
      "A hand-inked graphic-novel panel, confident brush lines, dramatic spot blacks, cross-hatching for shadow, a limited moody palette, cinematic and grown-up.",
  },
  {
    name: "Cel-shaded animation",
    prompt:
      "A frame from a stylish 2D animated film, clean cel-shaded color, soft painterly backgrounds, expressive character acting, atmospheric and full of life.",
  },
  {
    name: "Risograph print",
    prompt:
      "A retro risograph print, two or three overprinted spot colors, grainy misregistered texture, bold simple shapes, indie-zine warmth.",
  },
  {
    name: "Linocut print",
    prompt:
      "A hand-carved linocut print, bold black shapes, energetic carved texture, one or two accent colors, strong graphic silhouettes.",
  },
  {
    name: "Pixel art",
    prompt:
      "A detailed pixel-art scene, crisp limited palette, expressive sprites, atmospheric lighting, the lovingly crafted feel of a modern indie video game.",
  },
  {
    name: "Surreal dreamscape painting",
    prompt:
      "A surreal dreamscape painting in the spirit of Magritte and Dalí, impossible juxtapositions, luminous skies, crisp detail on a fantastical scene, quietly uncanny and poetic.",
  },
  {
    name: "Double-exposure silhouette",
    prompt:
      "A double-exposure image where a person's silhouette is filled with a layered landscape or scene, soft blended edges, evocative and abstract, more about mood than literal likeness.",
  },
  {
    name: "Ukiyo-e woodblock",
    prompt:
      "A Japanese ukiyo-e woodblock print, flat layered color, elegant outlines, stylized waves and clouds, refined composition with a sense of timeless calm.",
  },
  {
    name: "Art deco poster",
    prompt:
      "A 1920s art-deco poster, bold geometric forms, elegant symmetry, metallic gold and jewel tones, streamlined stylized figures, glamorous and graphic.",
  },
] as const;

export const JOURNAL_IMAGE_MODEL =
  process.env.JOURNAL_IMAGE_MODEL ?? "gpt-image-2";

type GenerationMode = "auto" | "manual";
type GenerationStatus =
  | "pending"
  | "generating"
  | "succeeded"
  | "attached"
  | "failed"
  | "skipped";

type EntryRow = {
  id: string;
  user_id: string;
  status: string;
  entry_type: JournalEntryType;
  opening_question: string | null;
  summary: string | null;
  title: string | null;
  pull_quote: string | null;
  quote_attribution: string | null;
  recap_body: string | null;
};

type ReferencePhoto = {
  photoId: string;
  memberEmail: string;
  memberName: string | null;
  storagePath: string;
  file: File;
};

export type GeneratedPhotoResult =
  | {
      ok: true;
      generationId: string;
      status: Exclude<GenerationStatus, "failed">;
      displayPath: string | null;
      attachedPhotoId: string | null;
    }
  | { ok: false; generationId: string | null; error: string };

let cachedOpenAI: OpenAI | null = null;

function openai(): OpenAI {
  if (cachedOpenAI) return cachedOpenAI;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  cachedOpenAI = new OpenAI({ apiKey });
  return cachedOpenAI;
}

export async function maybeAutoGenerateEntryPhoto(
  entryId: string
): Promise<GeneratedPhotoResult | { ok: true; skipped: true }> {
  const admin = createAdminClient();

  const { data: entry } = await admin
    .from("journal_entries")
    .select("id, user_id, status, entry_type")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry || entry.status !== "closed" || entry.entry_type !== "standard") {
    return { ok: true, skipped: true };
  }

  const { count: photoCount } = await admin
    .from("journal_entry_photos")
    .select("id", { count: "exact", head: true })
    .eq("entry_id", entryId);
  if ((photoCount ?? 0) > 0) return { ok: true, skipped: true };

  if (!(await isKidPresetUser(entry.user_id as string))) {
    return { ok: true, skipped: true };
  }

  const { data: existing } = await admin
    .from("journal_image_generations")
    .select("id")
    .eq("entry_id", entryId)
    .eq("mode", "auto")
    .in("status", ["pending", "generating", "succeeded", "attached"])
    .limit(1);
  if (existing && existing.length > 0) return { ok: true, skipped: true };

  return runEntryPhotoGeneration(entryId, {
    mode: "auto",
    attachOnSuccess: true,
    skipAttachIfEntryHasMedia: true,
  });
}

export async function runEntryPhotoGeneration(
  entryId: string,
  {
    mode,
    attachOnSuccess,
    skipAttachIfEntryHasMedia = false,
  }: {
    mode: GenerationMode;
    attachOnSuccess: boolean;
    skipAttachIfEntryHasMedia?: boolean;
  }
): Promise<GeneratedPhotoResult> {
  const admin = createAdminClient();
  const { data: entry, error: entryErr } = await admin
    .from("journal_entries")
    .select(
      "id, user_id, status, entry_type, opening_question, summary, title, pull_quote, quote_attribution, recap_body"
    )
    .eq("id", entryId)
    .maybeSingle();
  if (entryErr || !entry) {
    return { ok: false, generationId: null, error: "entry not found" };
  }

  const entryRow = entry as EntryRow;
  const { data: generation, error: insertErr } = await admin
    .from("journal_image_generations")
    .insert({
      entry_id: entryId,
      user_id: entryRow.user_id,
      status: "generating",
      mode,
      attach_on_success: attachOnSuccess,
    })
    .select("id")
    .single();
  if (insertErr || !generation) {
    return {
      ok: false,
      generationId: null,
      error: insertErr?.message ?? "failed to start image generation",
    };
  }

  const generationId = generation.id as string;

  try {
    const postText = await buildPostText(entryRow);
    const references = await pickReferencePhotos(entryRow.user_id, postText);
    const prompt = buildImagePrompt(postText, references);
    const imageBytes = await generateImageBytes({
      prompt,
      references,
      userId: entryRow.user_id,
    });
    const primaryReference = references[0] ?? null;

    const storagePath = `${entryRow.user_id}/${entryId}/${generationId}-generated.png`;
    const { error: uploadErr } = await admin.storage
      .from(PHOTOS_BUCKET)
      .upload(storagePath, imageBytes, {
        contentType: "image/png",
        upsert: false,
      });
    if (uploadErr) throw new Error(uploadErr.message);

    await admin
      .from("journal_image_generations")
      .update({
        status: "succeeded",
        prompt,
        generated_path: storagePath,
        display_path: storagePath,
        reference_member_email: references.map((ref) => ref.memberEmail).join(", ") || null,
        reference_member_name:
          references
            .map((ref) => ref.memberName)
            .filter(Boolean)
            .join(", ") || null,
        reference_photo_id: primaryReference?.photoId ?? null,
        reference_storage_path:
          references.map((ref) => ref.storagePath).join(", ") || null,
      })
      .eq("id", generationId);

    if (!attachOnSuccess) {
      return {
        ok: true,
        generationId,
        status: "succeeded",
        displayPath: storagePath,
        attachedPhotoId: null,
      };
    }

    if (skipAttachIfEntryHasMedia) {
      const { count: latestPhotoCount } = await admin
        .from("journal_entry_photos")
        .select("id", { count: "exact", head: true })
        .eq("entry_id", entryId);
      if ((latestPhotoCount ?? 0) > 0) {
        await admin.storage.from(PHOTOS_BUCKET).remove([storagePath]);
        await admin
          .from("journal_image_generations")
          .update({
            status: "skipped",
            error: "Entry already has media attached.",
            completed_at: new Date().toISOString(),
          })
          .eq("id", generationId);
        return {
          ok: true,
          generationId,
          status: "skipped",
          displayPath: null,
          attachedPhotoId: null,
        };
      }
    }

    const { data: photo, error: attachErr } = await admin
      .from("journal_entry_photos")
      .insert({
        entry_id: entryId,
        user_id: entryRow.user_id,
        media_type: "photo",
        source: "ai_generated",
        original_path: storagePath,
        display_path: storagePath,
      })
      .select("id")
      .single();
    if (attachErr || !photo) {
      throw new Error(attachErr?.message ?? "failed to attach generated photo");
    }

    await admin
      .from("journal_image_generations")
      .update({
        status: "attached",
        attached_photo_id: photo.id,
        completed_at: new Date().toISOString(),
      })
      .eq("id", generationId);

    return {
      ok: true,
      generationId,
      status: "attached",
      displayPath: storagePath,
      attachedPhotoId: photo.id as string,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[journal/generated-photo] generation failed:", message);
    await admin
      .from("journal_image_generations")
      .update({
        status: "failed",
        error: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", generationId);
    return { ok: false, generationId, error: message };
  }
}

export async function isKidPresetUser(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("journal_agent_files")
    .select("content")
    .eq("user_id", userId)
    .eq("name", "Interviewer")
    .maybeSingle();
  const templateId =
    typeof data?.content === "string" ? matchTemplateId(data.content) : null;
  return templateId === "elementary" || templateId === "middle" || templateId === "high";
}

async function buildPostText(entry: EntryRow): Promise<string> {
  if (entry.entry_type === "quote") {
    return [entry.pull_quote, entry.quote_attribution && `- ${entry.quote_attribution}`]
      .filter(Boolean)
      .join("\n")
      .slice(0, PROMPT_TEXT_LIMIT);
  }

  if (entry.entry_type === "recap") {
    return [entry.title, entry.summary, entry.recap_body]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, PROMPT_TEXT_LIMIT);
  }

  const admin = createAdminClient();
  const { data: messages } = await admin
    .from("journal_messages")
    .select("role, content")
    .eq("entry_id", entry.id)
    .order("created_at", { ascending: true });

  const thread = (messages ?? [])
    .map((m: { role: string; content: string }) =>
      `${m.role === "assistant" ? "Prompt" : "Post"}: ${m.content}`
    )
    .join("\n\n");

  return [entry.title, entry.summary, entry.opening_question, thread]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, PROMPT_TEXT_LIMIT);
}

async function pickReferencePhotos(
  userId: string,
  postText: string
): Promise<ReferencePhoto[]> {
  const admin = createAdminClient();
  const { data: members } = await admin
    .from("family_members")
    .select("email, name, user_id");

  const matchedEmails = new Set<string>();
  let authorEmail: string | null = null;
  const memberByEmail = new Map<string, { name: string | null; userId: string | null }>();

  for (const member of members ?? []) {
    const email = member.email as string;
    const name = (member.name as string | null)?.trim() || null;
    const memberUserId = (member.user_id as string | null) ?? null;
    memberByEmail.set(email, { name, userId: memberUserId });
    if (memberUserId === userId) authorEmail = email;
    if (name && memberNameMentioned(postText, name)) {
      matchedEmails.add(email);
    }
  }

  const candidateEmails =
    matchedEmails.size > 0
      ? [
          ...matchedEmails,
          ...(authorEmail && !matchedEmails.has(authorEmail) ? [authorEmail] : []),
        ]
      : authorEmail
        ? [authorEmail]
        : [];
  if (candidateEmails.length === 0) return [];

  const { data: photos } = await admin
    .from("journal_member_photos")
    .select("id, member_email, storage_path")
    .in("member_email", candidateEmails);
  if (!photos || photos.length === 0) return [];

  const references: ReferencePhoto[] = [];
  for (const email of candidateEmails) {
    const pool = photos.filter((p) => p.member_email === email);
    if (pool.length === 0) continue;

    const chosen = pool[Math.floor(Math.random() * pool.length)];
    const storagePath = chosen.storage_path as string;
    const { data: blob, error } = await admin.storage
      .from(MEMBER_PHOTOS_BUCKET)
      .download(storagePath);
    if (error || !blob) continue;

    const memberName = memberByEmail.get(email)?.name ?? null;
    const bytes = Buffer.from(await blob.arrayBuffer());
    const file = await toFile(bytes, `${referenceFileBase(memberName)}.jpg`, {
      type: blob.type || "image/jpeg",
    });
    references.push({
      photoId: chosen.id as string,
      memberEmail: email,
      memberName,
      storagePath,
      file,
    });

    if (references.length >= MAX_REFERENCE_PHOTOS) break;
  }

  return references;
}

function memberNameMentioned(text: string, name: string): boolean {
  const tokens = new Set([name.trim()]);
  const first = name.trim().split(/\s+/)[0];
  if (first && first.length >= 2) tokens.add(first);

  return [...tokens].some((token) => {
    const pattern = `(^|[^\\p{L}\\p{N}])${escapeRegex(token)}([^\\p{L}\\p{N}]|$)`;
    return new RegExp(pattern, "iu").test(text);
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function referenceFileBase(name: string | null): string {
  const slug = name
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `reference-${slug}` : "reference-family-member";
}

function buildImagePrompt(postText: string, references: ReferencePhoto[]): string {
  const style = ART_STYLES[Math.floor(Math.random() * ART_STYLES.length)];
  const referenceNames = references
    .map((reference) => reference.memberName)
    .filter(Boolean)
    .join(", ");
  const referenceLines =
    references.length > 0
      ? [
          referenceNames
            ? `Reference photos are provided for possible family members: ${referenceNames}.`
            : "Family reference photos are provided.",
          "Treat the reference photos as optional visual context, not a list of people who must appear.",
          "Decide from the journal post who the image is really about; do not add the author, narrator, or every referenced person unless the moment calls for them.",
          "When a referenced person naturally belongs in the scene, use their photo only as loose inspiration for broad likeness, hair, and expression. The image does not need to be a portrait.",
        ]
      : ["No reference photo is provided."];

  return [
    "Create one image inspired by this journal post.",
    "",
    "Image concept:",
    "Imagine a vivid, specific scene from the post rather than a literal summary.",
    "Make the scene feel alive, surprising, and emotionally true to the moment.",
    "It can include symbolic details or a lightly exaggerated premise when that makes the memory more evocative.",
    "",
    "Art style:",
    `${style.name}: ${style.prompt}`,
    "",
    "Constraints:",
    "Do not include readable text, captions, speech bubbles, logos, or watermarks.",
    "Do not make anything scary, mean, embarrassing, romantic, violent, or adult.",
    ...referenceLines,
    "",
    "Journal post:",
    postText.trim() || "A small happy journal moment.",
  ].join("\n");
}

async function generateImageBytes({
  prompt,
  references,
  userId,
}: {
  prompt: string;
  references: ReferencePhoto[];
  userId: string;
}): Promise<Buffer> {
  const client = openai();
  const response = references.length > 0
    ? await client.images.edit({
        model: JOURNAL_IMAGE_MODEL,
        image: references.map((reference) => reference.file),
        prompt,
        n: 1,
        size: IMAGE_SIZE,
        quality: "medium",
        output_format: "png",
        background: "opaque",
        user: userId,
      })
    : await client.images.generate({
        model: JOURNAL_IMAGE_MODEL,
        prompt,
        n: 1,
        size: IMAGE_SIZE,
        quality: "medium",
        output_format: "png",
        background: "opaque",
        user: userId,
      });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI did not return image data");
  return Buffer.from(b64, "base64");
}
