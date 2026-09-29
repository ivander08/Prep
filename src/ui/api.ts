/** Shared API types. Mirrors the server's JSON shapes. */

export type ListSummary = {
  name: string;
  n: number;
  /** Every problem in the list, including LeetCode Premium-only ones. */
  total: number;
  solved: number;
  /** Problems viewable without LeetCode Premium. */
  free: number;
  /** Premium-only problems, which cannot be opened or run here. */
  locked: number;
};

export type ProblemRow = {
  qid: number;
  slug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  position: number;
  solved: number;
};

export type CaseResult = {
  index: number;
  args: unknown[];
  /** The suite's own `nums = [3,3], target = 6` line. Absent on the examples path. */
  input?: string;
  expected: unknown;
  got: unknown;
  pass: boolean;
  error?: string;
};

export type RunResponse = {
  cases: CaseResult[];
  passed: number;
  total: number;
  accepted: boolean;
  durationMs: number;
  /** Suite cases dropped as ungradeable in this language; absent on the examples path. */
  skipped?: number;
  stderr?: string;
  parseWarning: string | null;
  disclaimer: string;
};

export type ProblemDetail = {
  qid: number;
  slug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  topics: string[];
  /** The roadmap pattern this problem belongs to, or null when it has none. */
  pattern: string | null;
  statementMd: string;
  /** 'leetcode' when fetched, 'manual' when pasted, null when neither. */
  statementSource: "leetcode" | "manual" | null;
  /** True when the statement is unavailable (LeetCode Premium) but the tests still work. */
  premiumLocked: boolean;
  /** True when an imported suite grades this problem in Python, making examples irrelevant. */
  hasSuite: boolean;
  hints: string[];
  snippets: Array<{ langSlug: string; code: string }>;
  meta: { name: string; params: Array<{ name: string; type: string }> };
  testCases: Array<{ args: unknown[]; expected: unknown }>;
  parseWarning: string | null;
  card: { due: string; reps: number; lapses: number; stability: number | null } | null;
  /** The unaided time limit that separates Easy from Good, for the attempt stopwatch. */
  gradeLimitSeconds: number;
};

export type AttemptResponse = {
  grade: number;
  nextDue: string | null;
  intervalDays: number | null;
};

export type DueTrack = "dsa" | "pattern" | "concept" | "component" | "design" | "behavioral" | "stack";

/** One item due for review, from any track. */
export type DueTrackItem = {
  kind: DueTrack;
  /** The identity that opens this item: a problem slug for `dsa`, a catalogue slug otherwise. */
  ref: string;
  title: string;
  due: string;
  reps: number;
  lapses: number;
  /** For a `pattern` row, the problem to re-solve. Null otherwise, and null if nothing passed. */
  problemSlug: string | null;
};

/**
 * The badge and the destination view for each track. One table rather than a switch at each
 * use site: the row renderer needs the label and the click handler needs the view, and they
 * must agree about which track is which.
 */
export const DUE_TRACK_LABEL: Record<DueTrack, string> = {
  dsa: "Problem",
  pattern: "Pattern",
  concept: "Concept",
  component: "Build",
  design: "Design",
  behavioral: "Behavioral",
  stack: "Stack",
};

/** Which nav view a due item opens. */
export const DUE_TRACK_VIEW: Record<DueTrack, "list" | "roadmap" | "fundamentals" | "components" | "design" | "behavioral" | "stack"> = {
  dsa: "list",
  pattern: "roadmap",
  concept: "fundamentals",
  component: "components",
  design: "design",
  behavioral: "behavioral",
  stack: "stack",
};

// ---------------------------------------------------------------------------
// Fundamentals
// ---------------------------------------------------------------------------

export type ConceptModule = "collections" | "strings" | "matrix" | "sorting" | "idioms" | "pitfalls";

export type ConceptSummary = {
  slug: string;
  lang: string;
  module: ConceptModule;
  moduleLabel: string;
  title: string;
  /** True once the concept has been passed and has a review card. */
  reviewed: boolean;
  prereq: string[] | null;
};

export type ConceptDetail = {
  id: number;
  lang: string;
  slug: string;
  module: ConceptModule;
  title: string;
  conceptMd: string;
  promptMd: string;
  starter: string;
  solution: string;
  fnName: string;
  tests: Array<{ args: unknown[]; expected: unknown }>;
  prereq: string[] | null;
  /** The unaided time limit that separates Easy from Good, for the attempt stopwatch. */
  gradeLimitSeconds: number;
};

export type ConceptRunResponse = RunResponse & {
  grade: number;
  nextDue: string | null;
  intervalDays: number | null;
};

// ---------------------------------------------------------------------------
// Components (executable system design)
// ---------------------------------------------------------------------------

export type ComponentModule = "caching" | "rate-limiting" | "coordination" | "storage" | "indexing";

export type ComponentSummary = {
  slug: string;
  lang: string;
  module: ComponentModule;
  moduleLabel: string;
  title: string;
  /** True once the component has been passed and has a review card. */
  reviewed: boolean;
  prereq: string[] | null;
};

export type ComponentDetail = {
  id: number;
  lang: string;
  slug: string;
  module: ComponentModule;
  title: string;
  conceptMd: string;
  promptMd: string;
  /** The exact `ops` encoding the starter parses — the interface, not a hint. */
  opFormat: string;
  starter: string;
  solution: string;
  fnName: string;
  tests: Array<{ args: unknown[]; expected: unknown }>;
  prereq: string[] | null;
  /** The unaided time limit that separates Easy from Good, for the attempt stopwatch. */
  gradeLimitSeconds: number;
};

export type ComponentRunResponse = RunResponse & {
  grade: number;
  nextDue: string | null;
  intervalDays: number | null;
};

export const GRADE_LABEL: Record<number, string> = {
  1: "Again",
  2: "Hard",
  3: "Good",
  4: "Easy",
};

// ---------------------------------------------------------------------------
// System design
// ---------------------------------------------------------------------------

export type DesignPhase = "requirements" | "estimation" | "highlevel" | "deepdive" | "wrapup";

/** The client-safe prompt summary. The answer key never leaves the server. */
export type DesignPromptSummary = { slug: string; title: string; statement: string };

export type DesignTranscriptEntry = {
  role: "interviewer" | "candidate";
  text: string;
  ts: string;
  probe?: number | null;
  /** Whether this turn was refused for leaking, and the family it named. */
  withheld?: boolean;
  probeName?: string | null;
};

export type DesignSession = {
  id: number;
  slug: string;
  title: string;
  statement: string;
  phase: DesignPhase;
  probeLevel: number;
  probesAsked: number;
  drafts: Record<string, string>;
  transcript: DesignTranscriptEntry[];
  seconds: number | null;
  startedAt: string;
  endedAt: string | null;
};

export type DesignTurnResult = {
  message: string;
  phase: DesignPhase;
  probeLevel: number;
  probeName: string | null;
  ceiling: number;
  reason: string;
  withheld: boolean;
  rejectionNote: string | null;
  model: string;
  costIdr: number;
  repaired: boolean;
};

export type RubricDimension =
  | "problemFraming"
  | "systemsThinking"
  | "technicalDepth"
  | "tradeoffReasoning"
  | "communication";

/**
 * A dimension's score with the evidence that earned it.
 *
 * `source` is the load-bearing field: `signal` means the mechanical check set this number
 * because the model produced no quote that could be found in the candidate's own text.
 */
export type DesignScore = {
  score: number;
  evidence: string;
  signalScore: number;
  source: "model" | "signal";
};

export type DesignSignals = {
  askedFunctional: boolean;
  askedNonFunctional: boolean;
  estimateCount: number;
  componentCount: number;
  tradeoffCount: number;
  namesFailure: boolean;
  matched: {
    functional: string[];
    nonFunctional: string[];
    estimates: string[];
    components: string[];
    tradeoffs: string[];
    failure: string[];
  };
};

export type DesignScores = {
  scores: Record<RubricDimension, DesignScore>;
  signals: DesignSignals;
  grade: number;
  summary: string;
  model: string;
  costIdr: number;
  nextDue: string | null;
  intervalDays: number | null;
  /**
   * The Build-track component that implements part of this design, or null.
   *
   * Sent with the finished round rather than with the prompt list, because naming the
   * component before the round would hint at the design.
   */
  componentSlug: string | null;
};

export const DIMENSION_LABEL: Record<RubricDimension, string> = {
  problemFraming: "Problem framing",
  systemsThinking: "Systems thinking",
  technicalDepth: "Technical depth",
  tradeoffReasoning: "Trade-off reasoning",
  communication: "Communication",
};

/**
 * Probe families (indices into the server's `PROBE_FAMILIES`) that a weak dimension points at.
 *
 * This mapping lives on the client because it answers a UI question — which concept to
 * recommend after a weak round — rather than a server one. `communication` maps to nothing:
 * the library is engineering content, and no concept fixes an unclear explanation.
 */
export const DIMENSION_PROBES: Record<RubricDimension, number[]> = {
  problemFraming: [5],
  systemsThinking: [0, 4],
  technicalDepth: [6],
  tradeoffReasoning: [4, 7],
  communication: [],
};

// ---------------------------------------------------------------------------
// Design concept library
// ---------------------------------------------------------------------------

export type DesignConceptGroup =
  | "foundations"
  | "replication"
  | "caching"
  | "partitioning"
  | "storage"
  | "messaging"
  | "resilience";

/** A concept as listed: title and one-line answer, without the body. */
export type DesignConceptSummary = {
  slug: string;
  group: DesignConceptGroup;
  title: string;
  summary: string;
  probeFamilies: number[];
};

export type DesignConcept = DesignConceptSummary & {
  /** The note. Markdown. */
  bodyMd: string;
  /** Design prompts this most often comes up in. */
  prompts: string[];
};

/** One concept's body, with its probe families named rather than numbered. */
export type DesignConceptDetail = {
  concept: DesignConcept;
  probes: Array<string | null>;
};

export type DesignConceptGroups = {
  groups: Array<{ group: DesignConceptGroup; label: string; concepts: DesignConceptSummary[] }>;
  total: number;
};

// ---------------------------------------------------------------------------
// Reference cards
// ---------------------------------------------------------------------------

export type PatternPriority = "High" | "Mid" | "Low";

export type PatternRefView = {
  pattern: string;
  priority: PatternPriority;
  complexity: Array<{ operation: string; cost: string }>;
  cornerCases: string[];
  pitfalls: string[];
  stdlib: Record<string, string>;
  recommended: Array<{ slug: string; title: string; difficulty: string }>;
};

// ---------------------------------------------------------------------------
// Progress: streak and milestones
// ---------------------------------------------------------------------------

export type StreakDay = {
  /** `YYYY-MM-DD`, local. */
  day: string;
  /** Graded events on that day. Drives the heatmap's intensity, not just its on/off. */
  count: number;
};

export type StreakStats = {
  /** Consecutive active days ending today or yesterday. */
  current: number;
  best: number;
  todayDone: boolean;
  /**
   * The heatmap's data: every day in a whole number of Monday-aligned weeks, oldest first,
   * including days with no activity as `count: 0`.
   */
  calendar: StreakDay[];
  activeDays: number;
};

export type MilestoneState = {
  id: string;
  title: string;
  requirement: string;
  earnedAt: string | null;
  progress: string | null;
};

// ---------------------------------------------------------------------------
// Behavioral and stack tracks
// ---------------------------------------------------------------------------

export type ProseTrackKind = "behavioral" | "stack";

/** A prompt as listed: the answer key is stripped and fetched per prompt. */
export type ProsePromptSummary = { slug: string; group: string; title: string; summary: string };

export type ProsePromptGroup = { group: string; label: string; prompts: ProsePromptSummary[] };

export type ProsePrompt = ProsePromptSummary & {
  statement: string;
  lookFor: string[];
  commonMistakes: string[];
};

/** One dimension's score with the evidence that earned it. */
export type TrackScore = {
  score: number;
  evidence: string;
  signalScore: number;
  source: "model" | "signal";
};

export type TrackSignals = {
  words: number;
  firstPerson: number;
  quantified: number;
  actionVerbs: number;
};

export type TrackGradeResult = {
  scores: Record<TrackDimension, TrackScore>;
  signals: TrackSignals;
  grade: number;
  summary: string;
  model: string;
  costIdr: number;
  nextDue: string | null;
  intervalDays: number | null;
};

export type TrackDimension = "structure" | "specificity" | "ownership" | "impact";

/** Display order, and the label each dimension renders under. */
export const TRACK_DIMENSIONS: TrackDimension[] = ["structure", "specificity", "ownership", "impact"];

export const TRACK_DIMENSION_LABEL: Record<TrackDimension, string> = {
  structure: "Structure",
  specificity: "Specificity",
  ownership: "Ownership",
  impact: "Impact",
};

export type TrackSession = {
  id: number;
  kind: ProseTrackKind;
  slug: string;
  title: string;
  statement: string;
  answerMd: string;
  startedAt: string;
  endedAt: string | null;
};

/**
 * An HTTP failure that keeps the status and the parsed body.
 *
 * The body matters: a 422 from `/api/run` is not a failure at all — it means "this problem
 * cannot be graded here", which the workspace renders as an explanation rather than an
 * error banner. Flattening every non-2xx into a bare `Error(message)` threw that
 * distinction away.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError(`${path} → non-JSON response: ${text.slice(0, 200)}`, res.status, null);
  }

  if (!res.ok) {
    const detail =
      json && typeof json === "object" && "error" in json && typeof json.error === "string"
        ? json.error
        : `HTTP ${res.status}`;
    throw new ApiError(detail, res.status, json);
  }

  return json as T;
}
