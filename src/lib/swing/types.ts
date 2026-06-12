// Domain types for the Swing Coach app. Shared between the client-side
// extraction pipeline (src/lib/swing/pipeline/*) and server code, so this
// module must stay framework-free and importable from both sides.

export type Bats = "L" | "R";

export type SessionStatus = "draft" | "analyzing" | "complete" | "analysis_failed";
export type ClipStatus = "pending" | "extracting" | "ok" | "rejected";
export type AssessmentStatus =
  | "generating"
  | "complete"
  | "analysis_failed"
  | "superseded"
  | "voided";

/** Minimum usable swings before analysis can run (R4: patterns, not single swings). */
export const MIN_USABLE_CLIPS = 3;
/** Below this many usable swings the assessment carries a low-sample caveat. */
export const LOW_SAMPLE_THRESHOLD = 5;

export const SWING_PHASES = [
  "stance",
  "load",
  "plant",
  "launch",
  "contact",
  "finish",
] as const;
export type SwingPhase = (typeof SWING_PHASES)[number];

/** Phase event times in clip-relative milliseconds (subset present if detection was partial). */
export type SwingEvents = Partial<Record<SwingPhase, number>>;

export type MetricConfidence = "high" | "medium" | "low";

export interface MetricValue {
  value: number;
  /** Trunk-derived metrics grade high; wrist/ankle-derived grade by visibility. */
  confidence: MetricConfidence;
  unit: "ratio" | "deg" | "ms" | "norm";
}

/**
 * The v1 candidate metric set (final membership scoped by the U1 spike).
 * Everything here is honestly derivable from a single side-on 2D skeleton;
 * separation degrees / rotational velocities / bat metrics are deliberately
 * absent (see plan: Key Technical Decisions).
 */
export const METRIC_KEYS = [
  "head_drift", // head travel stance→contact, normalized by hitter height
  "stride_length_ratio", // ankle-to-ankle at plant ÷ standing height
  "spine_angle_stance", // hip-mid→shoulder-mid vs vertical, degrees
  "spine_angle_contact",
  "posture_loss", // |spine_angle_contact - spine_angle_stance|
  "front_knee_angle_contact", // extension/blocking, degrees
  "back_elbow_slot", // elbow height relative to shoulder line during launch, normalized
  "load_duration", // ms
  "stride_duration", // ms
  "swing_duration", // launch→contact, ms
  "weight_transfer", // hip-midpoint horizontal travel ÷ stance width
  "hip_shoulder_timing", // hip rotation onset minus shoulder onset, ms (timing proxy, not degrees)
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export type SwingMetrics = Partial<Record<MetricKey, MetricValue>>;

export interface StillInfo {
  path: string;
  phase: SwingPhase;
  /** image/webp normally; image/jpeg on Safari (no WebP canvas encoder). */
  contentType: string;
  /** Which reference annotations were drawn (metric keys / labels) — captions in U11. */
  annotations: string[];
}

export interface SwingPlayer {
  id: string;
  name: string;
  birthYear: number;
  bats: Bats;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export interface SwingSession {
  id: string;
  playerId: string;
  status: SessionStatus;
  filmedOn: string; // date (YYYY-MM-DD)
  error: string | null;
  createdAt: string;
}

export interface SwingClip {
  id: string;
  sessionId: string;
  status: ClipStatus;
  rejectionReason: string | null;
  contentHash: string;
  fileName: string | null;
  sourceFps: number | null;
  durationSeconds: number | null;
  detectedBats: Bats | null;
  hitterHeight: number | null;
  filmedAt: string | null;
  events: SwingEvents | null;
  metrics: SwingMetrics | null;
  keypointsPath: string | null;
  stills: StillInfo[];
  createdAt: string;
}

export interface Drill {
  name: string;
  steps: string[];
  equipment?: string;
}

export interface EvidenceStill {
  path: string;
  phase: SwingPhase;
  contentType: string;
  caption: string;
}

export type ProgressVerdictKind = "keep" | "advance" | "replace";

export interface ProgressVerdict {
  priorFocusAreaId: string;
  verdict: ProgressVerdictKind;
  evidence: string;
}

export interface ParkedIssue {
  issueKey: string;
  summary: string;
}

export interface SwingFocusArea {
  id: string;
  assessmentId: string;
  playerId: string;
  rank: number;
  disposition: "focus" | "parked";
  priorFocusAreaId: string | null;
  issueKey: string;
  diagnosis: string;
  cue: string;
  drills: Drill[];
  tell: string;
  evidenceStills: EvidenceStill[];
  libraryGap: boolean;
  createdAt: string;
}

export interface SwingAssessment {
  id: string;
  sessionId: string;
  playerId: string;
  status: AssessmentStatus;
  narrative: string | null;
  progress: ProgressVerdict[];
  parked: ParkedIssue[];
  confidenceNotes: string | null;
  swingCount: number | null;
  model: string | null;
  promptVersion: string | null;
  error: string | null;
  createdAt: string;
}

export function ageFromBirthYear(birthYear: number, on = new Date()): number {
  return on.getFullYear() - birthYear;
}

/* ---------------------------------------------------------------- rows --- */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function playerFromRow(row: any): SwingPlayer {
  return {
    id: row.id,
    name: row.name,
    birthYear: row.birth_year,
    bats: row.bats,
    notes: row.notes ?? null,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
  };
}

export function sessionFromRow(row: any): SwingSession {
  return {
    id: row.id,
    playerId: row.player_id,
    status: row.status,
    filmedOn: row.filmed_on,
    error: row.error ?? null,
    createdAt: row.created_at,
  };
}

export function clipFromRow(row: any): SwingClip {
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    rejectionReason: row.rejection_reason ?? null,
    contentHash: row.content_hash,
    fileName: row.file_name ?? null,
    sourceFps: row.source_fps ?? null,
    durationSeconds: row.duration_seconds ?? null,
    detectedBats: row.detected_bats ?? null,
    hitterHeight: row.hitter_height ?? null,
    filmedAt: row.filmed_at ?? null,
    events: row.events ?? null,
    metrics: row.metrics ?? null,
    keypointsPath: row.keypoints_path ?? null,
    stills: row.stills ?? [],
    createdAt: row.created_at,
  };
}

export function assessmentFromRow(row: any): SwingAssessment {
  return {
    id: row.id,
    sessionId: row.session_id,
    playerId: row.player_id,
    status: row.status,
    narrative: row.narrative ?? null,
    progress: row.progress ?? [],
    parked: row.parked ?? [],
    confidenceNotes: row.confidence_notes ?? null,
    swingCount: row.swing_count ?? null,
    model: row.model ?? null,
    promptVersion: row.prompt_version ?? null,
    error: row.error ?? null,
    createdAt: row.created_at,
  };
}

export function focusAreaFromRow(row: any): SwingFocusArea {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    playerId: row.player_id,
    rank: row.rank,
    disposition: row.disposition,
    priorFocusAreaId: row.prior_focus_area_id ?? null,
    issueKey: row.issue_key,
    diagnosis: row.diagnosis,
    cue: row.cue,
    drills: row.drills ?? [],
    tell: row.tell,
    evidenceStills: row.evidence_stills ?? [],
    libraryGap: row.library_gap ?? false,
    createdAt: row.created_at,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
