/**
 * A student's Canvas, read with their own access key (Canvas › Account ›
 * Settings › New Access Token). Read-only: nothing here writes to Canvas.
 *
 * What a student's key can reach depends on the school's course settings. At
 * Bentley (checked 2026-11-06) the Pages and Files tabs are hidden from
 * students, so the course-wide lists 404/403, but a page linked from a module
 * and a file linked from an assignment both open individually. That's how the
 * sync reaches them.
 */

export class CanvasAuthError extends Error {
  constructor() {
    super("Canvas refused the access key (it has expired or was removed).");
  }
}

export type CanvasClient = {
  get<T>(path: string): Promise<T | null>;
  all<T>(path: string): Promise<T[]>;
};

export function canvasClient(baseUrl: string, token: string): CanvasClient {
  const api = `${baseUrl.replace(/\/+$/, "")}/api/v1`;
  const headers = { Authorization: `Bearer ${token}` };

  /** Null for a 403/404 (hidden from students); throws on a dead key. */
  async function request(url: string): Promise<Response | null> {
    const res = await fetch(url, { headers, cache: "no-store" });
    if (res.status === 401) throw new CanvasAuthError();
    if (res.status === 403 || res.status === 404) return null;
    if (!res.ok) throw new Error(`Canvas ${res.status} for ${url.replace(api, "")}`);
    return res;
  }

  return {
    async get<T>(path: string) {
      const res = await request(`${api}${path}`);
      return res ? ((await res.json()) as T) : null;
    },
    /** Every page of a list, following Canvas's Link headers. */
    async all<T>(path: string) {
      let url: string | undefined = `${api}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
      const out: T[] = [];
      while (url) {
        const res = await request(url);
        if (!res) break;
        out.push(...((await res.json()) as T[]));
        url = (res.headers.get("link") ?? "")
          .split(",")
          .find((l) => l.includes('rel="next"'))
          ?.match(/<([^>]+)>/)?.[1];
      }
      return out;
    },
  };
}

// --- The shapes the sync reads (only the fields it uses) ------------------------

export type CanvasUser = { id: number; name: string };

export type CanvasCourse = {
  id: number;
  name: string;
  course_code?: string;
  syllabus_body?: string | null;
};

export type CanvasRubricCriterion = {
  id: string;
  description?: string;
  long_description?: string;
  points?: number;
  ratings?: { description?: string; long_description?: string; points?: number }[];
};

export type CanvasSubmission = {
  workflow_state?: string;
  submitted_at?: string | null;
  graded_at?: string | null;
  score?: number | null;
  grade?: string | null;
  late?: boolean;
  missing?: boolean;
  excused?: boolean | null;
  body?: string | null;
  attachments?: { id: number; display_name: string; "content-type"?: string; size?: number }[];
  submission_comments?: { author_name?: string; comment?: string; created_at?: string }[];
  rubric_assessment?: Record<string, { points?: number | null; comments?: string | null }> | null;
};

export type CanvasAssignment = {
  id: number;
  course_id: number;
  name: string;
  description?: string | null;
  due_at?: string | null;
  unlock_at?: string | null;
  lock_at?: string | null;
  points_possible?: number | null;
  submission_types?: string[];
  quiz_id?: number;
  is_quiz_assignment?: boolean;
  html_url?: string;
  rubric?: CanvasRubricCriterion[];
};

export type CanvasModule = {
  id: number;
  name: string;
  position: number;
  items_count?: number;
  items?: { type: string; title: string; content_id?: number; page_url?: string; url?: string }[];
};

export type CanvasPage = { title: string; body?: string | null; updated_at?: string };

export type CanvasAnnouncement = {
  id: number;
  title: string;
  message?: string | null;
  posted_at?: string | null;
  context_code?: string;
};

export type CanvasFile = { id: number; display_name: string; "content-type"?: string; size?: number };
