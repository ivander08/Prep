/**
 * The SQL 50 track: list, read, grade, and schedule.
 *
 * Structurally the sibling of `components.ts` and `concepts.ts` — read a spec, submit an
 * answer, get a verdict, and on a pass the item is scheduled through `item_cards` — with one
 * difference that is the whole point of the track: the verdict comes from EXECUTING the
 * submission against a real database, not from a self-rating.
 *
 * `SQL_SOLUTIONS` is imported here and never leaves this module. `listSqlProblems` returns
 * summaries and `getSqlProblem` returns the statement, the schema and the seed rows; neither
 * includes the reference query, which is only handed to `gradeSql`.
 *
 * The attempt row is written to the same `attempts` table the DSA track uses, with
 * `language = 'sql'`, so the SQL work counts toward the streak, the milestone queries and the
 * weekly history with no special case anywhere downstream.
 */

import { db } from "../db.ts";
import { gradeAttempt, reviewSql } from "../srs.ts";
import type { Grade } from "ts-fsrs";
import { SQL_SOLUTIONS } from "./catalog.ts";
import { gradeSql, isReadOnly, normalizeDdl, parseCases, seedDatabase } from "./run.ts";

export type SqlProblemRow = {
  qid: number;
  slug: string;
  title: string;
  difficulty: string;
  position: number;
  /** Whether the statement and seed data have been fetched. A row that is not fetched cannot run. */
  fetched: boolean;
  /** Whether an attempt has ever passed. */
  solved: boolean;
  attempts: number;
};

const SELECT = `
  SELECT p.qid, p.slug, p.title, p.difficulty, l.position,
         p.fetched_at, p.statement_md, p.meta_json, p.examples,
         COALESCE((SELECT MAX(a.passed) FROM attempts a WHERE a.qid = p.qid), 0) AS solved,
         (SELECT COUNT(*) FROM attempts a WHERE a.qid = p.qid) AS attempts
  FROM lists l JOIN problems p ON p.qid = l.qid
`;

type Row = {
  qid: number;
  slug: string;
  title: string;
  difficulty: string;
  position: number;
  fetched_at: string | null;
  statement_md: string | null;
  meta_json: string | null;
  examples: string | null;
  solved: number;
  attempts: number;
};

/** Every SQL 50 problem in list order, with its solved marker. */
export function listSqlProblems(): SqlProblemRow[] {
  return db
    .query<Row, []>(`${SELECT} WHERE l.name = 'sql50' ORDER BY l.position ASC`)
    .all()
    .map((r) => ({
      qid: r.qid,
      slug: r.slug,
      title: r.title,
      difficulty: r.difficulty,
      position: r.position,
      fetched: r.fetched_at !== null,
      solved: r.solved === 1,
      attempts: r.attempts,
    }));
}

export type SqlProblemDetail = {
  slug: string;
  title: string;
  difficulty: string;
  statementMd: string;
  /** The normalized DDL, one statement per table, so the candidate can see the shape. */
  schema: string[];
  /** The seed rows per table for case 0, rendered for display. */
  seed: Array<{ table: string; columns: string[]; rows: Array<Array<string | number | null>> }>;
  /** How many stored cases the problem has. Only case 0 is graded; the rest are context. */
  caseCount: number;
  /** True when the answer is a mutation (a DELETE), so the UI says so instead of showing rows. */
  mutating: boolean;
  card: { due: string; reps: number; lapses: number } | null;
};

/**
 * One problem, ready to solve.
 *
 * The DDL and the seed rows are rendered here rather than sent raw: the candidate has to know
 * the table shape to write anything, and shipping `meta_json`/`examples` would put the MySQL
 * DDL in front of them unnormalized — a dialect their own query is not running on.
 */
export function getSqlProblem(slug: string): SqlProblemDetail | null {
  const row = db
    .query<Row, [string]>(`${SELECT} WHERE l.name = 'sql50' AND p.slug = ?`)
    .get(slug);
  if (!row) return null;

  if (row.fetched_at === null || !row.meta_json || !row.examples) {
    // Not an error the client should dress up: the statement was never fetched, so there is
    // nothing to solve. `bun run ingest:sql` is the fix and the message names it.
    throw new Error(`${slug}: not fetched. Run \`bun run ingest:sql\` first.`);
  }

  const reference = SQL_SOLUTIONS[slug];
  if (!reference) throw new Error(`${slug}: no reference query in the catalogue`);

  const meta = JSON.parse(row.meta_json) as { mysql?: string[] };
  const cases = parseCases(row.examples, slug);

  // Seeding proves the DDL and rows actually apply, which is also what the grader does, so a
  // problem whose seed is broken fails here with the same message the run would produce.
  const probe = seedDatabase(slug, row.meta_json, row.examples, 0);
  const tables = probe
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((t) => t.name);

  const seed = tables.map((table) => {
    const rows = probe.query(`SELECT * FROM "${table}"`).values() as unknown[][];
    const columns = probe
      .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('${table}')`)
      .all()
      .map((c) => c.name);
    return { table, columns, rows: rows as Array<Array<string | number | null>> };
  });
  probe.close();

  const card = db
    .query<{ due: string; reps: number; lapses: number }, [string]>(
      `SELECT ic.due, ic.reps, ic.lapses FROM item_cards ic JOIN items i ON i.id = ic.item_id
       WHERE i.kind = 'sql' AND i.ref = ?`,
    )
    .get(slug);

  return {
    slug,
    title: row.title,
    difficulty: row.difficulty,
    statementMd: row.statement_md ?? "",
    // The DDL is normalized for display by running it through the same path the seeder uses,
    // which is the only version guaranteed to be the one the query actually ran against. Trimming
    // alone showed MySQL DDL the candidate could not have run: `recyclable-and-low-fat-products`
    // displayed `low_fats ENUM('Y', 'N')`, which SQLite does not accept, while the grader had
    // already rewritten it to `TEXT`.
    schema: (meta.mysql ?? []).map((s) => normalizeDdl(s).trim()),
    seed,
    caseCount: cases.length,
    mutating: !isReadOnly(reference),
    card: card ?? null,
  };
}

export type SqlRunResult = {
  passed: boolean;
  userRows: unknown[][];
  expectedRows: unknown[][];
  error: string | null;
  mutating: boolean;
  /** The reference query, revealed only after a pass. */
  reference: string | null;
  grade: number;
  nextDue: string | null;
  intervalDays: number | null;
};

/**
 * Run a submission, and on a pass schedule the problem.
 *
 * The grade is `gradeAttempt`'s behavioural derivation — the same function the DSA, concept and
 * component paths call — so a fast unaided pass is Easy, a slow one Good, and a failure Again.
 * There is no self-rating anywhere in this app and SQL is not an exception.
 */
export function runSql(slug: string, query: string, seconds: number): SqlRunResult {
  const row = db
    .query<Row, [string]>(`${SELECT} WHERE l.name = 'sql50' AND p.slug = ?`)
    .get(slug);
  if (!row) throw new Error(`unknown SQL problem: ${slug}`);
  if (row.fetched_at === null || !row.meta_json || !row.examples) {
    throw new Error(`${slug}: not fetched. Run \`bun run ingest:sql\` first.`);
  }

  const reference = SQL_SOLUTIONS[slug];
  if (!reference) throw new Error(`${slug}: no reference query in the catalogue`);

  const graded = gradeSql({
    slug,
    metaJson: row.meta_json,
    examples: row.examples,
    caseIndex: 0,
    userQuery: query,
    referenceQuery: reference,
  });

  const grade = gradeAttempt({
    passed: graded.passed,
    hintsUsed: 0,
    solutionUnlocked: false,
    seconds,
  }) as Grade;

  const now = new Date();
  // The attempt row and the card it schedules are one transaction, so a crash between them cannot
  // advance the schedule with no record of why. `bun:sqlite` transactions are synchronous.
  const schedule = db.transaction((): { due: Date; intervalDays: number } | null => {
    db.run(
      `INSERT INTO attempts (qid, started_at, ended_at, passed, tests_passed, tests_total,
                             hints_used, max_hint_level, solution_unlocked, seconds, code, language, grade)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, 'sql', ?)`,
      [
        row.qid,
        new Date(now.getTime() - seconds * 1000).toISOString(),
        now.toISOString(),
        graded.passed ? 1 : 0,
        graded.passed ? 1 : 0,
        1,
        seconds,
        query,
        grade,
      ],
    );

    // Scheduled only when the query actually RAN and PRODUCED THE RIGHT ROWS. The previous
    // condition was `graded.error === null` — "did not error" — so a query that ran cleanly and
    // returned the wrong rows still created a card. The comment above it said "produced the right
    // rows" and cited the DSA rule `passed || testsPassed > 0`, which is a pass test, not an
    // error test.
    return graded.passed ? reviewSql(slug, row.title, grade, now) : null;
  })();

  return {
    passed: graded.passed,
    userRows: graded.userRows,
    expectedRows: graded.expectedRows,
    error: graded.error,
    mutating: graded.mutating,
    reference: graded.passed ? reference : null,
    grade,
    nextDue: schedule?.due.toISOString() ?? null,
    intervalDays: schedule?.intervalDays ?? null,
  };
}

/** Progress through the list, for the header. */
export function sqlProgress(): { total: number; solved: number; fetched: number } {
  const row = db
    .query<{ total: number; solved: number; fetched: number }, []>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN p.fetched_at IS NOT NULL THEN 1 ELSE 0 END) AS fetched,
              SUM(CASE WHEN EXISTS (
                    SELECT 1 FROM attempts a WHERE a.qid = p.qid AND a.passed = 1
                  ) THEN 1 ELSE 0 END) AS solved
       FROM lists l JOIN problems p ON p.qid = l.qid WHERE l.name = 'sql50'`,
    )
    .get();
  return { total: row?.total ?? 0, solved: row?.solved ?? 0, fetched: row?.fetched ?? 0 };
}
