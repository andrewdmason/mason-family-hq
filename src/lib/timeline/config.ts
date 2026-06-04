import type { TimelineCategory, TimelineProminence } from "@/lib/types";

/** Human-readable category labels. The DB stores stable slugs; this is the one
 * place slugs become display text (used by the prompt serializer and the UI). */
export const CATEGORY_LABEL: Record<TimelineCategory, string> = {
  origins: "Origins",
  childhood: "Childhood",
  education: "Education",
  career: "Career",
  recognition: "Recognition & Creative Work",
  relationships: "Relationships",
  children_family: "Children & Family",
  homes: "Homes & Relocation",
  travel: "Travel & Adventure",
  music_hobbies: "Music & Hobbies",
  health_hard_times: "Health & Hard Times",
};

/**
 * Per-category color. `dot` paints the timeline node + period bar; `chip` styles
 * the category pill. Full literal class strings so Tailwind's scanner keeps them.
 */
export const CATEGORY_COLOR: Record<TimelineCategory, { dot: string; chip: string }> = {
  origins: { dot: "bg-stone-500", chip: "bg-stone-100 text-stone-700 ring-stone-200" },
  childhood: { dot: "bg-amber-500", chip: "bg-amber-100 text-amber-800 ring-amber-200" },
  education: { dot: "bg-sky-500", chip: "bg-sky-100 text-sky-700 ring-sky-200" },
  career: { dot: "bg-indigo-500", chip: "bg-indigo-100 text-indigo-700 ring-indigo-200" },
  recognition: { dot: "bg-fuchsia-500", chip: "bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-200" },
  relationships: { dot: "bg-rose-500", chip: "bg-rose-100 text-rose-700 ring-rose-200" },
  children_family: { dot: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-700 ring-emerald-200" },
  homes: { dot: "bg-teal-500", chip: "bg-teal-100 text-teal-700 ring-teal-200" },
  travel: { dot: "bg-orange-500", chip: "bg-orange-100 text-orange-700 ring-orange-200" },
  music_hobbies: { dot: "bg-violet-500", chip: "bg-violet-100 text-violet-700 ring-violet-200" },
  health_hard_times: { dot: "bg-slate-500", chip: "bg-slate-100 text-slate-700 ring-slate-200" },
};

/** Node size + title typography per prominence — the prioritization dial. */
export const PROMINENCE_STYLE: Record<
  TimelineProminence,
  { node: string; title: string }
> = {
  major: { node: "h-5 w-5", title: "text-lg font-semibold" },
  medium: { node: "h-4 w-4", title: "text-base font-medium" },
  minor: { node: "h-3 w-3", title: "text-sm" },
};

/**
 * Per-person color, keyed by family-member email. The timeline color-codes events
 * by whose life they belong to (replacing category color in the visualization), so
 * a family timeline reads as a weave of four colored threads. Full literal classes
 * keep Tailwind's scanner happy.
 */
export type PersonStyle = { ring: string; text: string; dot: string; soft: string };

export const PERSON_COLOR: Record<string, PersonStyle> = {
  "andrew@mason.io": { ring: "ring-amber-400", text: "text-amber-700", dot: "bg-amber-400", soft: "bg-amber-50" },
  "jenny@mason.io": { ring: "ring-rose-400", text: "text-rose-700", dot: "bg-rose-400", soft: "bg-rose-50" },
  "oscar@mason.io": { ring: "ring-emerald-400", text: "text-emerald-600", dot: "bg-emerald-400", soft: "bg-emerald-50" },
  "sebastian@mason.io": { ring: "ring-sky-400", text: "text-sky-600", dot: "bg-sky-400", soft: "bg-sky-50" },
};

export const PERSON_FALLBACK: PersonStyle = {
  ring: "ring-slate-300",
  text: "text-slate-600",
  dot: "bg-slate-400",
  soft: "bg-slate-50",
};

export function personColor(email?: string | null): PersonStyle {
  return (email && PERSON_COLOR[email.toLowerCase()]) || PERSON_FALLBACK;
}
