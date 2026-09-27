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
  hints: string[];
  snippets: Array<{ langSlug: string; code: string }>;
  meta: { name: string; params: Array<{ name: string; type: string }> };
  testCases: Array<{ args: unknown[]; expected: unknown }>;
  parseWarning: string | null;
  card: { due: string; reps: number; lapses: number; stability: number | null } | null;
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

export const GRADE_LABEL: Record<number, string> = {
  1: "Again",
  2: "Hard",
  3: "Good",
  4: "Easy",
};

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
    throw new Error(`${path} → non-JSON response: ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const detail =
      json && typeof json === "object" && "error" in json && typeof json.error === "string"
        ? json.error
        : `HTTP ${res.status}`;
    throw new Error(detail);
  }

  return json as T;
}
