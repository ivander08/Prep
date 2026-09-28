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

export type DueItem = {
  qid: number;
  slug: string;
  title: string;
  difficulty: string;
  due: string;
  reps: number;
  lapses: number;
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

export const GRADE_LABEL: Record<number, string> = {
  1: "Again",
  2: "Hard",
  3: "Good",
  4: "Easy",
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
