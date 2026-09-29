/**
 * The prose tracks — session state and orchestration.
 *
 * Behavioral and stack answers take the same path: pick a prompt, write an answer, get it
 * graded against a rubric, and have the grade schedule the prompt for review. So this is one
 * module parameterised by `kind`, not two, following `design/index.ts`'s
 * start → save → grade → review shape.
 *
 * The two catalogues differ only in which module supplies the prompt and its answer key. The
 * session table is shared (`track_sessions`), the grader is shared (`tracks/grade.ts`), and the
 * schedule goes through the same `reviewProse` seam as the pattern and design cards — so the
 * only place the tracks are told apart is `SOURCES` below.
 *
 * A grade of 1 does NOT schedule. That rule lives here rather than in the grader, matching the
 * design round: the grade is reported either way, because the feedback is what the exercise is
 * for, but only an answer that cleared the bottom band is evidence worth coming back to.
 */

import type { Grade } from "ts-fsrs";
import { db } from "../db.ts";
import { reviewProse } from "../srs.ts";
import { gradeProseAnswer, type TrackGradeResult } from "./grade.ts";
import {
  GROUP_LABEL as BEHAVIORAL_LABEL,
  GROUP_ORDER as BEHAVIORAL_ORDER,
  getBehavioralPrompt,
  listBehavioralPrompts,
} from "../behavioral/catalog.ts";
import {
  GROUP_LABEL as STACK_LABEL,
  GROUP_ORDER as STACK_ORDER,
  getStackPrompt,
  listStackPrompts,
} from "../stack/catalog.ts";

export type ProseTrackKind = "behavioral" | "stack";

export const PROSE_TRACK_KINDS: ProseTrackKind[] = ["behavioral", "stack"];

/** A prompt as listed: the answer key stripped, because the list is browsed, not answered. */
export type TrackPromptSummary = { slug: string; group: string; title: string; summary: string };

/** A prompt with its answer key, served only when the prompt is actually opened. */
export type TrackPrompt = TrackPromptSummary & {
  statement: string;
  lookFor: string[];
  commonMistakes: string[];
};

export type TrackGroup = { group: string; label: string; prompts: TrackPromptSummary[] };

type TrackRow = {
  id: number;
  kind: string;
  slug: string;
  started_at: string;
  ended_at: string | null;
  answer_md: string;
  scores: string | null;
  grade: number | null;
  model: string | null;
  cost_idr: number | null;
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
 * The two catalogues behind one interface.
 *
 * Both export the same four things under different names, so naming them once here is what
 * lets every function below be written against a `kind` rather than against two branches. The
 * `label`/`order` types are widened to `string` on purpose: the two catalogues key them by
 * different unions, and a shared signature cannot be written over both without it.
 */
const SOURCES: Record<
  ProseTrackKind,
  {
    order: readonly string[];
    label: Record<string, string>;
    list: () => TrackPromptSummary[];
    get: (slug: string) => TrackPrompt | null;
  }
> = {
  behavioral: {
    order: BEHAVIORAL_ORDER,
    label: BEHAVIORAL_LABEL,
    list: listBehavioralPrompts,
    get: getBehavioralPrompt,
  },
  stack: {
    order: STACK_ORDER,
    label: STACK_LABEL,
    list: listStackPrompts,
    get: getStackPrompt,
  },
};

export function isProseTrackKind(v: string): v is ProseTrackKind {
  return v === "behavioral" || v === "stack";
}

/** The prompt list, grouped for the sidebar. Summaries only — the answer key stays server-side. */
export function listTrackGroups(kind: ProseTrackKind): TrackGroup[] {
  const src = SOURCES[kind];
  const all = src.list();
  return src.order
    .map((group) => ({
      group,
      label: src.label[group] ?? group,
      prompts: all.filter((p) => p.group === group),
    }))
    .filter((g) => g.prompts.length > 0);
}

/** One prompt with its answer key, or null if the slug is not in this track's catalogue. */
export function getTrackPrompt(kind: ProseTrackKind, slug: string): TrackPrompt | null {
  return SOURCES[kind].get(slug);
}

function readRow(id: number): TrackRow {
  const row = db.query<TrackRow, [number]>("SELECT * FROM track_sessions WHERE id = ?").get(id);
  if (!row) throw new Error(`unknown track session: ${id}`);
  return row;
}

/**
 * Put a session row into the view.
 *
 * `title` and `statement` come from the catalogue rather than the row, because the catalogue is
 * the authority on them: a reworded prompt then shows its new wording against an old session
 * instead of the text it had when the session was created.
 */
function hydrate(row: TrackRow): TrackSession | null {
  if (!isProseTrackKind(row.kind)) return null;
  const prompt = getTrackPrompt(row.kind, row.slug);
  return {
    id: row.id,
    kind: row.kind,
    slug: row.slug,
    title: prompt?.title ?? row.slug,
    statement: prompt?.statement ?? "",
    answerMd: row.answer_md,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export function loadTrackSession(id: number): TrackSession | null {
  return hydrate(readRow(id));
}

/** Start a new attempt. Returns the row id. */
export function startTrackSession(kind: ProseTrackKind, slug: string): number {
  if (!getTrackPrompt(kind, slug)) throw new Error(`unknown ${kind} prompt: ${slug}`);
  db.run("INSERT INTO track_sessions (kind, slug, started_at) VALUES (?, ?, ?)", [
    kind,
    slug,
    new Date().toISOString(),
  ]);
  const row = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get();
  if (!row) throw new Error("failed to create track session");
  return row.id;
}

/** Persist the answer draft, so a reload does not lose work. */
export function saveTrackAnswer(id: number, answerMd: string): void {
  readRow(id);
  db.run("UPDATE track_sessions SET answer_md = ? WHERE id = ?", [answerMd, id]);
}

/**
 * The most recent unfinished attempt of this kind that has work in it, if any.
 *
 * "Has work in it" is load-bearing, the same way it is for the design round: selecting a prompt
 * creates a row immediately, so someone who clicks three prompts while deciding orphans two
 * empty ones — and a plain "newest unfinished" rule would resume the last abandoned click
 * instead of the answer they are actually writing.
 */
export function latestOpenTrackSession(kind: ProseTrackKind): TrackSession | null {
  const row = db
    .query<{ id: number }, [string]>(
      `SELECT id FROM track_sessions
       WHERE kind = ? AND ended_at IS NULL AND answer_md <> ''
       ORDER BY id DESC LIMIT 1`,
    )
    .get(kind);
  return row ? loadTrackSession(row.id) : null;
}

/**
 * Grade a finished attempt and schedule it.
 *
 * The session is marked graded only after the model returns, so a grading failure leaves the
 * answer intact and resubmittable — the error propagates and the row is untouched. That is the
 * same order `gradeDesign` uses, and it is why the UPDATE is at the end rather than the start.
 */
export async function finishTrackSession(
  id: number,
): Promise<TrackGradeResult & { nextDue: string | null; intervalDays: number | null }> {
  const row = readRow(id);
  if (row.ended_at !== null) throw new Error("session already graded");
  if (!isProseTrackKind(row.kind)) throw new Error(`unknown track kind: ${row.kind}`);

  const prompt = getTrackPrompt(row.kind, row.slug);
  if (!prompt) throw new Error(`unknown ${row.kind} prompt: ${row.slug}`);

  const result = await gradeProseAnswer({
    kind: row.kind,
    title: prompt.title,
    statement: prompt.statement,
    lookFor: prompt.lookFor,
    commonMistakes: prompt.commonMistakes,
    answer: row.answer_md,
  });

  db.run(
    "UPDATE track_sessions SET scores = ?, grade = ?, model = ?, cost_idr = ?, ended_at = ? WHERE id = ?",
    [
      JSON.stringify(result.scores),
      result.grade,
      result.model,
      result.costIdr,
      new Date().toISOString(),
      id,
    ],
  );

  // Only an answer that cleared the bottom band comes back for review. A grade of 1 is not
  // evidence of an answer worth revisiting, so it is reported and not scheduled.
  if (result.grade <= 1) return { ...result, nextDue: null, intervalDays: null };

  const s = reviewProse(row.kind, prompt.slug, prompt.title, result.grade as Grade);
  return { ...result, nextDue: s.due.toISOString(), intervalDays: s.intervalDays };
}
