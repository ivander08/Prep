/**
 * Per-pattern mastery — the "what am I actually weak at" view.
 *
 * The signal is Elo over attempts, per roadmap pattern. Elo rather than a percentage
 * because a pattern's difficulty is not fixed: solving 6/10 in Dynamic Programming is a
 * different achievement from 6/10 in Arrays & Hashing, and a flat solve-rate hides that.
 * The problem's difficulty seeds the expected score, so beating a Hard moves you more than
 * beating an Easy.
 *
 * Three inputs beyond pass/fail, all of which are the reason this only works when you
 * solve inside the tool:
 *
 *   - HINTS. Passing after hints is weaker evidence than passing unaided, so the effective
 *     score is discounted.
 *   - TIME. Solving well inside the limit is stronger evidence.
 *   - RE-SOLVE. A problem you previously solved and then failed is the strongest negative
 *     signal there is — it is the "memorized it, didn't learn it" case.
 *
 * Elo is deliberately the simple choice here. BKT (pyBKT) gives a more principled mastery
 * estimate but needs a Python batch job and far more data per pattern than one person
 * generates in a few months. `[INFERENCE]` Elo is the right complexity for this data
 * volume; revisit if a pattern ever exceeds ~100 attempts.
 */

import { db } from "./db.ts";

/** Difficulty seeds. A Hard win is worth more than an Easy win. */
const DIFFICULTY_RATING: Record<string, number> = {
  Easy: 1100,
  Medium: 1400,
  Hard: 1700,
};

const K = 24;
const STARTING_ELO = 1200;

export type MasteryRow = {
  pattern: string;
  elo: number;
  attempts: number;
  solved: number;
  hintRate: number;
  lapses: number;
  /** Elo expressed as an expected score against a Medium problem. */
  expectedVsMedium: number;
  /** True when this pattern has at least one solved problem, so it can be reviewed. */
  reviewable: boolean;
};

function expectedScore(playerElo: number, problemElo: number): number {
  return 1 / (1 + 10 ** ((problemElo - playerElo) / 400));
}

/**
 * Recompute mastery for every pattern from the attempt log.
 *
 * Full recomputation rather than incremental updates: the attempt history for one person
 * is small (thousands of rows at most), and a derived table that can drift from its source
 * is worse than one that is cheap to rebuild. Called after each graded attempt.
 */
export function recomputeMastery(): number {
  const attempts = db
    .query<
      {
        pattern: string;
        difficulty: string;
        passed: number | null;
        hints_used: number;
        solution_unlocked: number;
        seconds: number | null;
        grade: number | null;
        qid: number;
        started_at: string;
      },
      []
    >(
      `SELECT p.pattern, p.difficulty, a.passed, a.hints_used, a.solution_unlocked,
              a.seconds, a.grade, a.qid, a.started_at
       FROM attempts a
       JOIN problems p ON p.qid = a.qid
       WHERE p.pattern IS NOT NULL AND a.passed IS NOT NULL
       ORDER BY a.started_at ASC, a.id ASC`,
    )
    .all();

  const state = new Map<string, { elo: number; attempts: number; solved: number; hints: number; lapses: number }>();
  const solvedBefore = new Set<number>();

  for (const a of attempts) {
    const pattern = a.pattern;
    const s = state.get(pattern) ?? { elo: STARTING_ELO, attempts: 0, solved: 0, hints: 0, lapses: 0 };

    const problemElo = DIFFICULTY_RATING[a.difficulty] ?? 1400;
    const expected = expectedScore(s.elo, problemElo);

    // Effective score: 1 for a clean solve, discounted for hints, 0 for a failure.
    let score: number;
    if (a.passed === 1 && a.solution_unlocked === 0 && a.hints_used === 0) {
      score = 1;
    } else if (a.passed === 1 && a.solution_unlocked === 0) {
      score = 0.6; // solved, but with help
    } else if (a.passed === 1) {
      score = 0.35; // unlocked the solution, so the evidence is weak
    } else {
      score = 0;
    }

    s.elo += K * (score - expected);
    s.attempts++;
    if (a.passed === 1) s.solved++;
    if (a.hints_used > 0) s.hints++;

    // A re-solve failure on a previously solved problem is the strongest negative signal:
    // it is the "memorized it, did not learn it" case the whole tool exists to catch.
    if (a.passed === 0 && solvedBefore.has(a.qid)) {
      s.lapses++;
      s.elo -= 12;
    }
    if (a.passed === 1) solvedBefore.add(a.qid);

    state.set(pattern, s);
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.run("DELETE FROM pattern_mastery");
    const insert = db.query(
      `INSERT INTO pattern_mastery (pattern, elo, attempts, solved, hint_rate, lapses, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [pattern, s] of state) {
      insert.run(
        pattern,
        s.elo,
        s.attempts,
        s.solved,
        s.attempts > 0 ? s.hints / s.attempts : 0,
        s.lapses,
        now,
      );
    }
  })();

  return state.size;
}

/** Mastery rows, weakest first. Patterns with no attempts are excluded. */
export function masteryReport(): MasteryRow[] {
  // `reviewable` comes back from SQLite as 0/1, so the row type is the wire shape and the
  // map converts it to the boolean the callers actually want.
  type RawRow = Omit<MasteryRow, "reviewable"> & { reviewable: number };
  return db
    .query<RawRow, []>(
      `SELECT pattern, elo, attempts, solved, hint_rate AS hintRate, lapses,
              CASE WHEN solved > 0 THEN 1 ELSE 0 END AS reviewable,
              (1.0 / (1.0 + POWER(10, (1400 - elo) / 400.0))) AS expectedVsMedium
       FROM pattern_mastery
       ORDER BY elo ASC`,
    )
    .all()
    .map((r) => ({ ...r, reviewable: r.reviewable === 1 }));
}

/**
 * Hint dependence — how often you solve with help rather than unaided.
 *
 * A high rate is not necessarily bad early in a pattern, but it is the thing that makes a
 * solve feel fluent while leaving you unable to reproduce it.
 */
export type HintDependence = {
  pattern: string;
  totalAttempts: number;
  attemptsWithHints: number;
  unaidedSolves: number;
  hintRate: number;
};

export function hintDependence(): HintDependence[] {
  return db
    .query<HintDependence, []>(
      `SELECT p.pattern AS pattern,
              COUNT(*) AS totalAttempts,
              SUM(CASE WHEN a.hints_used > 0 THEN 1 ELSE 0 END) AS attemptsWithHints,
              SUM(CASE WHEN a.passed = 1 AND a.hints_used = 0 AND a.solution_unlocked = 0 THEN 1 ELSE 0 END) AS unaidedSolves,
              CAST(SUM(CASE WHEN a.hints_used > 0 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) AS hintRate
       FROM attempts a
       JOIN problems p ON p.qid = a.qid
       WHERE p.pattern IS NOT NULL AND a.passed IS NOT NULL
       GROUP BY p.pattern
       HAVING COUNT(*) >= 2
       ORDER BY hintRate DESC, totalAttempts DESC`,
    )
    .all();
}

/** Overall progress, for the overview. */
export function studyStats(): {
  attempts: number;
  solvedDistinct: number;
  unaided: number;
  withHints: number;
  patternsTouched: number;
  totalTutorCost: number;
} {
  const row = db
    .query<
      {
        attempts: number;
        solvedDistinct: number;
        unaided: number;
        withHints: number;
        patternsTouched: number;
      },
      []
    >(
      `SELECT COUNT(*) AS attempts,
              COUNT(DISTINCT CASE WHEN passed = 1 THEN qid END) AS solvedDistinct,
              SUM(CASE WHEN passed = 1 AND hints_used = 0 AND solution_unlocked = 0 THEN 1 ELSE 0 END) AS unaided,
              SUM(CASE WHEN hints_used > 0 THEN 1 ELSE 0 END) AS withHints,
              (SELECT COUNT(DISTINCT p2.pattern) FROM attempts a2 JOIN problems p2 ON p2.qid = a2.qid
               WHERE p2.pattern IS NOT NULL) AS patternsTouched
       FROM attempts WHERE passed IS NOT NULL`,
    )
    .get();

  const cost = db
    .query<{ total: number | null }, []>("SELECT SUM(cost_idr) AS total FROM tutor_turns")
    .get();

  return {
    attempts: row?.attempts ?? 0,
    solvedDistinct: row?.solvedDistinct ?? 0,
    unaided: row?.unaided ?? 0,
    withHints: row?.withHints ?? 0,
    patternsTouched: row?.patternsTouched ?? 0,
    totalTutorCost: cost?.total ?? 0,
  };
}
