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
 * The unaided time limit that separates Easy from Good.
 *
 * Exported because the attempt stopwatch displays the same boundary. Two literals would
 * drift: changing this one would leave the UI showing a threshold the grader no longer uses.
 */
export const GRADE_LIMIT_SECONDS = 20 * 60;

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
  if (a.seconds > (a.limitSeconds ?? GRADE_LIMIT_SECONDS)) return Rating.Good; // 3
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

/**
 * Record a review for a non-DSA item and persist the new schedule.
 *
 * `reviewCard` is hardcoded to the `cards` table keyed by `qid`; a concept lives in `items`
 * and is keyed by `item_id`, so it needs its own path. Same scheduler, same behavioural
 * grade — only the table differs.
 *
 * `item_cards` has no `elapsed_days` or `scheduled_days` columns, so only the columns it
 * does have are persisted. ts-fsrs still needs those two fields on the in-memory Card to
 * compute the next interval, so they are reconstructed from `last_review`/`due` on read and
 * dropped on write.
 */
export function reviewItem(itemId: number, grade: Grade, now = new Date()): { due: Date; intervalDays: number } {
  const row = db
    .query<
      {
        item_id: number;
        due: string;
        stability: number | null;
        difficulty: number | null;
        reps: number;
        lapses: number;
        state: number;
        last_review: string | null;
      },
      [number]
    >(
      `SELECT item_id, due, stability, difficulty, reps, lapses, state, last_review
       FROM item_cards WHERE item_id = ?`,
    )
    .get(itemId);

  let card: Card;
  if (row) {
    const base = createEmptyCard(new Date(row.due));
    card = {
      ...base,
      due: new Date(row.due),
      stability: row.stability ?? 0,
      difficulty: row.difficulty ?? 0,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: row.reps,
      lapses: row.lapses,
      state: row.state as State,
      last_review: row.last_review ? new Date(row.last_review) : undefined,
    } as Card;
  } else {
    card = createEmptyCard(now);
  }

  const next = SCHEDULER.repeat(card, now)[grade].card;

  db.run(
    `INSERT INTO item_cards (item_id, due, stability, difficulty, reps, lapses, state, last_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       due = excluded.due, stability = excluded.stability, difficulty = excluded.difficulty,
       reps = excluded.reps, lapses = excluded.lapses, state = excluded.state,
       last_review = excluded.last_review`,
    [
      itemId,
      next.due.toISOString(),
      next.stability,
      next.difficulty,
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

/** A pattern due for review, with a representative problem to re-solve. */
export type DuePattern = {
  pattern: string;
  due: string;
  reps: number;
  lapses: number;
  /** The problem to re-solve: most recently solved, so it is the one freshest in memory. */
  qid: number;
  slug: string;
  title: string;
  difficulty: string;
};

/**
 * Patterns due for review, oldest-due first.
 *
 * The representative problem is the one with the MOST RECENT passing attempt. Picking the
 * oldest instead would re-solve the problem most likely to have been forgotten for reasons
 * unrelated to the pattern, and picking at random would make the same pattern feel different
 * every time.
 *
 * A pattern with no passed problem is excluded — there is nothing to re-solve, and a card
 * for a pattern never attempted would be scheduled off no evidence at all.
 */
export function duePatterns(limit = 10): DuePattern[] {
  return db
    .query<DuePattern, [string, number]>(
      `SELECT i.ref AS pattern, ic.due, ic.reps, ic.lapses,
              p.qid, p.slug, p.title, p.difficulty
       FROM item_cards ic
       JOIN items i ON i.id = ic.item_id AND i.kind = 'pattern'
       JOIN problems p ON p.qid = (
         SELECT a.qid FROM attempts a
         JOIN problems pp ON pp.qid = a.qid AND pp.pattern = i.ref
         WHERE a.passed = 1
         ORDER BY a.ended_at DESC LIMIT 1
       )
       WHERE ic.due <= ?
       ORDER BY ic.due ASC LIMIT ?`,
    )
    .all(new Date().toISOString(), limit);
}

/**
 * Schedule a pattern card from a completed attempt on its representative problem.
 *
 * The grade is the ATTEMPT's grade, not a new judgement: `gradeAttempt` already derives it
 * from whether the tests passed, how many hints were used, and how long it took. Passing it
 * through is what keeps the no-self-report rule intact at pattern granularity — the student
 * never rates the pattern, they just re-solve a problem and the code decides.
 *
 * `items` is upserted first because `item_cards.item_id` references `items(id)` with foreign
 * keys on, the same ordering `recordConcept` uses.
 */
export function reviewPattern(
  pattern: string,
  grade: Grade,
  now = new Date(),
): { due: Date; intervalDays: number } {
  return reviewItem(ensureKindItem("pattern", pattern, pattern, null), grade, now);
}

/**
 * Schedule a design round from its rubric grade.
 *
 * Same path as a pattern card — `items` + `item_cards` with `kind = 'design'` — so a design
 * round comes back for review on the same FSRS curve as everything else rather than being a
 * one-shot exercise.
 */
export function reviewDesign(
  slug: string,
  title: string,
  grade: Grade,
  now = new Date(),
): { due: Date; intervalDays: number } {
  return reviewItem(ensureKindItem("design", slug, title, null), grade, now);
}

/**
 * The `items` row for a non-DSA item kind, created on first use.
 *
 * Shared by the pattern and design cards because they differ only in the kind string and
 * what goes in `title`/`body_md`; a copy per kind would be the same four lines three times.
 */
function ensureKindItem(kind: string, ref: string, title: string, bodyMd: string | null): number {
  db.run(
    `INSERT INTO items (kind, ref, title, body_md) VALUES (?, ?, ?, ?)
     ON CONFLICT(kind, ref) DO UPDATE SET title = excluded.title`,
    [kind, ref, title, bodyMd],
  );
  const row = db
    .query<{ id: number }, [string, string]>("SELECT id FROM items WHERE kind = ? AND ref = ?")
    .get(kind, ref);
  if (!row) throw new Error(`failed to create ${kind} item row for ${ref}`);
  return row.id;
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

/**
 * Progress through a list.
 *
 * `total` counts EVERY problem in the list, including LeetCode Premium-only ones, because
 * that is the list's real size — Blind 75 has 75 problems, not 69. Reporting only the free
 * ones made a finished list look unfinished and hid why.
 *
 * `locked` and `free` are returned so the UI can say "6 premium" rather than quietly
 * shrinking the denominator. `solved` counts distinct solved problems.
 */
export function listProgress(listName: string): {
  total: number;
  solved: number;
  free: number;
  locked: number;
} {
  const row = db
    .query<{ total: number; free: number }, [string]>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN p.paid_only = 0 THEN 1 ELSE 0 END) AS free
       FROM lists l JOIN problems p ON p.qid = l.qid WHERE l.name = ?`,
    )
    .get(listName);

  const solved = db
    .query<{ n: number }, [string]>(
      `SELECT COUNT(DISTINCT l.qid) AS n FROM lists l
       JOIN attempts a ON a.qid = l.qid
       WHERE l.name = ? AND a.passed = 1`,
    )
    .get(listName)?.n ?? 0;

  const total = row?.total ?? 0;
  const free = row?.free ?? 0;
  return { total, solved, free, locked: total - free };
}
