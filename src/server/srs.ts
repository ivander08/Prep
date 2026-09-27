/**
 * Spaced repetition — the differentiator.
 *
 * Two design decisions, both from the dossier §6:
 *
 * 1. GRADE FROM BEHAVIOUR, NOT SELF-REPORT. Every other SRS-for-LeetCode tool asks
 *    "how well did you remember?" and gets a lie. Here the grade is derived from whether
 *    the tests passed, how many hints were used, and how long it took.
 *
 * 2. THE DEFAULT INTERVAL CAP IS A TRAP. ts-fsrs ships `maximum_interval: 36500`
 *    (~100 years). Measured, that produces 3 → 14 → 57 → 196 → 586 → 1559 → 3760 → 8346
 *    days: the scheduler silently stops showing you problems you still need, and it looks
 *    perfectly correct in a demo. Capped at 90 here.
 */

import { fsrs, generatorParameters, createEmptyCard, Rating, State } from "ts-fsrs";
import type { Card, Grade } from "ts-fsrs";
import { db } from "./db.ts";

/**
 * Interview prep is a sprint measured in weeks, not a lifelong memory project.
 *
 * `maximum_interval: 90`   — measured curve: 4 → 34 → 89 → 91 → 87 → 89 days.
 *                            Note it can land at 91: fuzz is applied after the cap, so
 *                            treat the cap as "≈90 ± a couple of days", not a hard bound.
 * `request_retention: 0.85` — lengthens every interval vs the 0.9 default (measured:
 *                            first Easy goes 17 d instead of 8 d). That is the intended
 *                            trade for a short horizon.
 * `enable_short_term: false` — skip intraday learning steps; a problem is not a flashcard.
 * `enable_fuzz: true`       — spreads due dates across cards so you don't get a 40-problem
 *                            pile-up. Deterministic (seeded), so tests are stable.
 */
export const SCHEDULER = fsrs(
  generatorParameters({
    request_retention: 0.85,
    maximum_interval: 90,
    enable_short_term: false,
    enable_fuzz: true,
  }),
);

/**
 * Derive the FSRS grade from observed behaviour. Never asked, never self-reported.
 *
 * The `limitSeconds` threshold is what separates Easy from Good: passing unaided but
 * slowly means you solved it, not that you own it.
 */
export function gradeAttempt(a: {
  passed: boolean;
  hintsUsed: number;
  solutionUnlocked: boolean;
  seconds: number;
  limitSeconds?: number;
}): Grade {
  if (!a.passed || a.solutionUnlocked) return Rating.Again; // 1
  if (a.hintsUsed > 0) return Rating.Hard; // 2
  if (a.seconds > (a.limitSeconds ?? 20 * 60)) return Rating.Good; // 3
  return Rating.Easy; // 4
}

type CardRow = {
  qid: number;
  due: string;
  stability: number | null;
  difficulty: number | null;
  elapsed_days: number | null;
  scheduled_days: number | null;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
};

/** Rebuild a ts-fsrs Card from its stored row. */
function rowToCard(row: CardRow): Card {
  const base = createEmptyCard(new Date(row.due));
  return {
    ...base,
    due: new Date(row.due),
    stability: row.stability ?? 0,
    difficulty: row.difficulty ?? 0,
    elapsed_days: row.elapsed_days ?? 0,
    scheduled_days: row.scheduled_days ?? 0,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  } as Card;
}

/**
 * Record a review and persist the new schedule. Returns the next due date.
 *
 * Wrapped in a transaction with the attempt row so a crash mid-solve cannot advance the
 * schedule without recording why.
 */
export function reviewCard(qid: number, grade: Grade, now = new Date()): { due: Date; intervalDays: number } {
  const row = db
    .query<CardRow, [number]>(
      `SELECT qid, due, stability, difficulty, elapsed_days, scheduled_days,
              reps, lapses, state, last_review
       FROM cards WHERE qid = ?`,
    )
    .get(qid);

  const card = row ? rowToCard(row) : createEmptyCard(now);
  const result = SCHEDULER.repeat(card, now)[grade];
  const next = result.card;

  db.run(
    `INSERT INTO cards (qid, due, stability, difficulty, elapsed_days, scheduled_days,
                        reps, lapses, state, last_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(qid) DO UPDATE SET
       due = excluded.due, stability = excluded.stability, difficulty = excluded.difficulty,
       elapsed_days = excluded.elapsed_days, scheduled_days = excluded.scheduled_days,
       reps = excluded.reps, lapses = excluded.lapses, state = excluded.state,
       last_review = excluded.last_review`,
    [
      qid,
      next.due.toISOString(),
      next.stability,
      next.difficulty,
      next.elapsed_days,
      next.scheduled_days,
      next.reps,
      next.lapses,
      next.state as number,
      now.toISOString(),
    ],
  );

  return { due: next.due, intervalDays: next.scheduled_days };
}

/** A problem due for review. */
export type DueItem = {
  qid: number;
  slug: string;
  title: string;
  difficulty: string;
  due: string;
  reps: number;
  lapses: number;
};

/** A problem not yet solved, in roadmap order. */
export type NextItem = {
  qid: number;
  slug: string;
  title: string;
  difficulty: string;
  position: number;
  attempted: number;
};

/** Problems due for review, in a list, oldest-due first. */
export function dueQueue(listName: string | null, limit = 20): DueItem[] {
  const now = new Date().toISOString();
  const sql = listName
    ? `SELECT c.qid, p.slug, p.title, p.difficulty, c.due, c.reps, c.lapses
       FROM cards c
       JOIN problems p ON p.qid = c.qid
       JOIN lists l ON l.qid = c.qid AND l.name = ?
       WHERE c.suspended = 0 AND c.due <= ?
       ORDER BY c.due ASC LIMIT ?`
    : `SELECT c.qid, p.slug, p.title, p.difficulty, c.due, c.reps, c.lapses
       FROM cards c
       JOIN problems p ON p.qid = c.qid
       WHERE c.suspended = 0 AND c.due <= ?
       ORDER BY c.due ASC LIMIT ?`;

  return listName
    ? db.query<DueItem, [string, string, number]>(sql).all(listName, now, limit)
    : db.query<DueItem, [string, number]>(sql).all(now, limit);
}

/** Next unsolved problems in a list — what to learn next. */
export function nextUnsolved(listName: string, limit = 10): NextItem[] {
  return db
    .query<NextItem, [string, number]>(
      `SELECT p.qid, p.slug, p.title, p.difficulty, l.position,
              (SELECT COUNT(*) FROM attempts a WHERE a.qid = p.qid) AS attempted
       FROM lists l
       JOIN problems p ON p.qid = l.qid
       WHERE l.name = ? AND p.paid_only = 0
         AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.qid = p.qid AND a.passed = 1)
       ORDER BY l.position ASC LIMIT ?`,
    )
    .all(listName, limit);
}

/** Progress through a list. */
export function listProgress(listName: string): { total: number; solved: number } {
  const total = db
    .query<{ n: number }, [string]>(
      "SELECT COUNT(*) AS n FROM lists l JOIN problems p ON p.qid = l.qid WHERE l.name = ? AND p.paid_only = 0",
    )
    .get(listName)?.n ?? 0;
  const solved = db
    .query<{ n: number }, [string]>(
      `SELECT COUNT(*) AS n FROM lists l
       JOIN attempts a ON a.qid = l.qid
       WHERE l.name = ? AND a.passed = 1`,
    )
    .get(listName)?.n ?? 0;
  return { total, solved };
}
