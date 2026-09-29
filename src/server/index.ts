/**
 * Prep: local interview prep server.
 *
 * Single-user, local-only. No auth, no accounts, no hosting: the app binds to 127.0.0.1
 * and everything lives in one SQLite file. That keeps problem statements cached locally
 * instead of redistributed, which is what makes using LeetCode's API defensible
 * (dossier §10).
 */

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { UI_DIR } from "./paths.ts";
import { db, migrate, getMeta, setMeta } from "./db.ts";
import { fetchProblem, htmlToMarkdown, hintToMarkdown } from "./leetcode.ts";
import { buildTestCases, runFullTests, type FullTestRow, type ProblemMeta } from "./executor.ts";
import { entryPointName, hasStructuredSuite, runSuiteAnyLanguage } from "./grading.ts";
import { runInLanguage } from "./runner.ts";
import { LANGUAGES, detectAvailableLanguages } from "./languages.ts";
import { dueItems, listProgress, reviewCard, reviewPattern, reviewDesign, gradeAttempt, GRADE_LIMIT_SECONDS } from "./srs.ts";
import type { Grade } from "ts-fsrs";
import { tutorTurn, reviewAttempt } from "./tutor/index.ts";
import { hintCeiling, ceilingReason } from "./tutor/policy.ts";
import { fetchCatalog, allRoleModels, setRoleModel, ROLE_LABEL, ROLES } from "./models.ts";
import { masteryReport, hintDependence, studyStats, recomputeMastery } from "./mastery.ts";
import { listDesignPrompts, getDesignPrompt } from "./design/catalog.ts";
import { designTurn, gradeDesign, latestOpenSession, loadSession, saveDraft, saveSketch, startDesignSession } from "./design/index.ts";
import { GROUP_LABEL, GROUP_ORDER, getDesignConcept, listDesignConcepts } from "./design/concepts.ts";
import { PROBE_FAMILIES } from "./design/policy.ts";
import {
  finishTrackSession,
  getTrackPrompt,
  latestOpenTrackSession,
  listTrackGroups,
  loadTrackSession,
  saveTrackAnswer,
  startTrackSession,
  type ProseTrackKind,
} from "./tracks/index.ts";
import { getPatternRefView, patternPriorities } from "./reference.ts";
import { streakStats } from "./streak.ts";
import { evaluateMilestones } from "./milestones.ts";
import {
  conceptModules,
  getConcept,
  listConcepts,
  recordConcept,
  runConcept,
  seedConcepts,
  LANG_LABEL,
  LANGS,
} from "./concepts.ts";
import {
  componentModules,
  getComponent,
  listComponents,
  recordComponent,
  runComponent,
  seedComponents,
  LANG_LABEL as COMPONENT_LANG_LABEL,
  LANGS as COMPONENT_LANGS,
} from "./components.ts";
import { getSqlProblem, listSqlProblems, runSql, sqlProgress } from "./sql/index.ts";

migrate();

// The concept catalogue is code, so it is seeded on every boot, not migrated: an edit to
// the prose or an exemplar then takes effect on reload without a new migration.
seedConcepts();
seedComponents();

const app = new Hono();

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

app.get("/api/lists", (c) => {
  const rows = db
    .query<{ name: string; n: number }, []>(
      "SELECT name, COUNT(*) AS n FROM lists GROUP BY name ORDER BY n DESC",
    )
    .all();

  return c.json({
    lists: rows.map((r) => ({ ...r, ...listProgress(r.name) })),
    catalog: db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM problems").get()?.n ?? 0,
    ingestedAt: getMeta("ingested_at"),
  });
});

/**
 * Catalog-wide problem search.
 *
 * There is deliberately no `Problems` nav entry (see the note in `App.tsx`): a generic entry that
 * rendered the active list under a new heading was worse than the list buttons themselves. That
 * decision left 4,068 problems with no way to reach the ones outside a curated list, which is
 * most of them. This endpoint is the missing half — a list view can search what it already
 * fetched, and this searches everything.
 *
 * Registered BEFORE `/api/problems/:slug`, which would otherwise match "search" as a slug and
 * answer 404 "problem not found" for a search that works.
 *
 * Matches slug as well as title because the slug is what a URL or a colleague says
 * ("two-sum"). A `LIKE` over 4,068 rows is fast enough without a full-text table, and the
 * ordering puts an exact slug match first: plain relevance would return "Two Sum II",
 * "Two Sum IV" and "Two Sum Less Than K" above the problem actually named "Two Sum".
 */
app.get("/api/problems/search", (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length === 0) return c.json({ problems: [], query: "" });

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  // `%` and `_` are LIKE wildcards, so a query containing them would turn one character into
  // "anything". Escaped, with `ESCAPE` declared, so they match literally.
  const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
  const pattern = `%${escaped}%`;

  const rows = db
    .query<
      { qid: number; slug: string; title: string; difficulty: string; pattern: string | null; solved: number },
      [string, string, string, string, string, number]
    >(
      `SELECT p.qid, p.slug, p.title, p.difficulty, p.pattern,
              COALESCE((SELECT MAX(a.passed) FROM attempts a WHERE a.qid = p.qid), 0) AS solved
       FROM problems p
       WHERE p.title LIKE ? ESCAPE '\\' OR p.slug LIKE ? ESCAPE '\\'
       ORDER BY
         CASE WHEN p.slug = ? THEN 0
              WHEN p.slug LIKE ? ESCAPE '\\' THEN 1
              WHEN p.title LIKE ? ESCAPE '\\' THEN 2
              ELSE 3 END,
         p.qid ASC
       LIMIT ?`,
    )
    .all(pattern, pattern, q.toLowerCase(), `${escaped.toLowerCase()}%`, `${escaped}%`, limit);

  return c.json({ problems: rows, query: q });
});

/**
 * Problem detail. The statement is fetched from LeetCode on first open and cached in
 * SQLite forever after: one network call per problem, ever.
 */
app.get("/api/problems/:slug", async (c) => {
  const slug = c.req.param("slug");
  const row = db
    .query<
      {
        qid: number;
        slug: string;
        title: string;
        difficulty: string;
        topics: string | null;
        pattern: string | null;
        statement_md: string | null;
        statement_source: string | null;
        hints: string | null;
        snippets: string | null;
        meta_json: string | null;
        examples: string | null;
        fetched_at: string | null;
      },
      [string]
    >(
      `SELECT qid, slug, title, difficulty, topics, pattern, statement_md, statement_source, hints,
              snippets, meta_json, examples, fetched_at
       FROM problems WHERE slug = ?`,
    )
    .get(slug);

  if (!row) return c.json({ error: "problem not found" }, 404);

  let {
    statement_md: statementMd,
    statement_source: statementSource,
    hints,
    snippets,
    meta_json: metaJson,
    examples,
  } = row;

  /**
   * Fetch once, then never again.
   *
   * The guard is `fetched_at IS NULL`, not `statement_md IS NULL`. A Premium problem
   * returns `content: null`, so it stores an empty statement. An empty string is falsy,
   * which made every open of a locked problem re-fetch from LeetCode. That is a
   * network call per page view for a result that cannot change.
   *
   * A manually pasted statement is also exempt: `statement_source = 'manual'` means the user
   * wrote it, and a later fetch would overwrite their text with nothing, with no notice.
   */
  if (row.fetched_at === null && statementSource !== "manual") {
    try {
      const detail = await fetchProblem(slug);
      statementMd = detail.content ? htmlToMarkdown(detail.content) : "";
      statementSource = detail.content ? "leetcode" : null;
      hints = JSON.stringify(detail.hints ?? []);
      snippets = JSON.stringify(detail.codeSnippets ?? []);
      // `null`, not `"{}"`. The empty object is a non-null truthy string, so it passed every later
      // `if (!meta_json)` guard while `JSON.parse("{}").params` is `undefined`; and because
      // `fetched_at` was also set, the `fetched_at IS NULL` guard above meant the poisoned row was
      // never re-fetched. Storing `null` keeps the row re-fetchable and makes the guards work.
      metaJson = detail.metaData ?? null;
      examples = detail.exampleTestcases ?? "";

      db.run(
        `UPDATE problems SET statement_md = ?, statement_source = ?, hints = ?, snippets = ?,
                             meta_json = ?, examples = ?, fetched_at = ? WHERE qid = ?`,
        [
          statementMd,
          statementSource,
          hints,
          snippets,
          metaJson,
          examples,
          new Date().toISOString(),
          row.qid,
        ],
      );
    } catch (e) {
      return c.json({ error: `failed to fetch statement: ${String(e)}` }, 502);
    }
  }

  // Whether a suite will actually grade this problem in Python. The statement-parsed examples
  // are then irrelevant, so the warning below is only meaningful when this is false.
  const hasSuite = hasStructuredSuite(slug);

  const parsed = buildTestCases({
    statementMd: statementMd ?? "",
    exampleTestcases: examples,
    metaData: metaJson,
  });

  const card = db
    .query<{ due: string; reps: number; lapses: number; stability: number | null }, [number]>(
      "SELECT due, reps, lapses, stability FROM cards WHERE qid = ?",
    )
    .get(row.qid);

  // Premium-only and no prose. The tests still work: 375 Premium problems have imported
  // suites, and `exampleTestcases`/`metaData` come back unauthenticated. So this is not an
  // error, it is one missing piece of the page. The signal is precise: examples came back
  // but the statement did not, the Premium response shape.
  const premiumLocked = !statementMd && (examples ?? "").trim().length > 0;

  return c.json({
    qid: row.qid,
    slug: row.slug,
    title: row.title,
    difficulty: row.difficulty,
    topics: (row.topics ?? "").split(",").filter(Boolean),
    pattern: row.pattern,
    statementMd,
    statementSource,
    premiumLocked,
    hints: (JSON.parse(hints ?? "[]") as string[]).map(hintToMarkdown),
    snippets: JSON.parse(snippets ?? "[]") as Array<{ langSlug: string; code: string }>,
    meta: parsed.meta,
    testCases: parsed.cases.map((tc) => ({ args: tc.args, expected: tc.expected })),
    // Returned as-is; the UI suppresses it when `hasSuite` and Python is selected, because a
    // 101-case suite is what grades the run then, and a "cannot be auto-graded" line beside an
    // accepted verdict reads as a contradiction.
    parseWarning: parsed.parseWarning ?? null,
    hasSuite,
    card: card ?? null,
    gradeLimitSeconds: GRADE_LIMIT_SECONDS,
  });
});

/**
 * Store a statement the user pasted.
 *
 * Premium problems return `content: null` unauthenticated, so there is no fetch that
 * recovers the prose. Pasting is the only path, and `statement_source = 'manual'` marks it
 * so a later fetch never overwrites it.
 */
app.post("/api/problems/:slug/statement", async (c) => {
  const slug = c.req.param("slug");
  const body = (await c.req.json().catch(() => ({}))) as { statementMd?: string };
  const md = (body.statementMd ?? "").trim();
  if (md.length === 0) return c.json({ error: "statementMd is empty" }, 400);

  const row = db.query<{ qid: number }, [string]>("SELECT qid FROM problems WHERE slug = ?").get(slug);
  if (!row) return c.json({ error: "problem not found" }, 404);

  db.run("UPDATE problems SET statement_md = ?, statement_source = 'manual' WHERE qid = ?", [
    md,
    row.qid,
  ]);
  return c.json({ ok: true, statementMd: md, statementSource: "manual" });
});

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * A returned value too large to send, replaced by a note.
 *
 * `got` is unbounded: it is whatever the student's code returned, so one wrong answer that
 * builds a large structure can serialise to megabytes for a single case (measured: 1.3 MB
 * for one case of a 400x40 string matrix). Grading happens on the raw value before this
 * point, so replacing the payload here changes only what is displayed, never the verdict.
 *
 * The limit is generous: the largest legitimate answer in the corpus is a 5040-permutation
 * list at ~100 KB, and the largest expected value is 408 bytes.
 */
const MAX_TRANSPORT_CHARS = 200_000;

const cappable = (v: unknown): unknown => {
  const s = JSON.stringify(v);
  return s === undefined || s.length <= MAX_TRANSPORT_CHARS
    ? v
    : `[${s.length} characters — too large to display]`;
};

app.post("/api/run", async (c) => {
  const body = (await c.req.json()) as { slug: string; code: string; fnName?: string; language?: string };
  const problem = db
    .query<{ meta_json: string | null; statement_md: string | null; examples: string | null }, [string]>(
      "SELECT meta_json, statement_md, examples FROM problems WHERE slug = ?",
    )
    .get(body.slug);

  if (!problem) return c.json({ error: "unknown problem" }, 404);

  // NOTE: an empty `statement_md` is not a reason to refuse. A Premium problem stores an
  // empty statement by design and still has a usable suite, so refusing here would make 375
  // gradeable Premium problems unrunnable.

  const language = body.language ?? "python3";

  // Prefer the imported full test suite: 37-144 executable cases instead of 2-3 public
  // examples, so it catches far more.
  //
  // This is not Python-only, and it never needed to be. `io_cases` is a JSON array of
  // `{input: "nums = [3,3]", output: "[0,1]"}` pairs and both sides are parsed in TypeScript,
  // so the cases are language-agnostic; only the dataset's generated `check()` asserts are
  // Python. Every language therefore runs the same cases through its own harness and is
  // graded by the same TypeScript comparison.
  const suite = db
    .query<FullTestRow, [string]>(
      "SELECT slug, entry_point, prelude, test_body, io_cases FROM full_tests WHERE slug = ?",
    )
    .get(body.slug);

  const meta = problem.meta_json ? (JSON.parse(problem.meta_json) as ProblemMeta) : null;

  if (suite?.io_cases) {
    const graded = await runSuiteAnyLanguage({
      slug: body.slug,
      code: body.code,
      fnName: body.fnName ?? meta?.name ?? entryPointName(suite.entry_point),
      ioJson: suite.io_cases,
      meta,
      language,
    });

    // A suite that cannot be graded at all — a `void` entry point, or a parameter type no
    // harness can construct. Answered as 422 with the reason, because returning the grader's
    // zero-case result would render as "0 of 0 passed" against code that may be correct.
    if (graded.ungradeable !== null) {
      return c.json({ error: graded.ungradeable, noGradeableTests: true }, 422);
    }

    return c.json({
      source: "suite",
      accepted: graded.accepted,
      passed: graded.passed,
      total: graded.total,
      skipped: graded.skipped,
      semantic: graded.semanticCount > 0,
      durationMs: graded.durationMs,
      // Every case, not the first 40. A suite runs up to 128 (sort-colors) and a truncated
      // list hides the failing case the student is looking for: the count line said "18/72"
      // while only 40 were ever rendered.
      cases: graded.cases.map((c) => ({
        index: c.index,
        input: c.input,
        args: c.args,
        expected: c.expected,
        got: cappable(c.got),
        pass: c.pass,
        ...(c.error ? { error: c.error } : {}),
      })),
      failedAssertion: graded.cases.find((c) => !c.pass)?.input ?? null,
      stderr: graded.stderr,
      parseWarning: null,
      disclaimer:
        `${graded.total} structured cases from the community LeetCodeDataset (Apache-2.0)` +
        (graded.semanticCount > 0 ? ", graded with a semantic verifier so any valid ordering is accepted" : "") +
        (graded.skipped > 0 ? `; ${graded.skipped} skipped as ungradeable` : "") +
        `. Not LeetCode's own hidden tests.`,
    });
  }

  // A suite with no parsed `io_cases` can still be run, but only in Python: the dataset
  // ships it as Python `assert` statements calling a Python entry point, so there is nothing
  // to hand another language.
  if (suite && language === "python3") {
    const full = await runFullTests({ code: body.code, suite });
    return c.json({
      source: full.source,
      accepted: full.passed,
      passed: full.passed ? full.assertions : 0,
      total: full.assertions,
      durationMs: full.durationMs,
      cases: [],
      failedAssertion: full.failedAssertion,
      stderr: full.error ?? undefined,
      parseWarning: null,
      disclaimer:
        `Graded against ${full.assertions} assertions from the community LeetCodeDataset ` +
        `(Apache-2.0) — a much closer proxy than the public examples, but not LeetCode's own hidden tests.`,
    });
  }

  const parsed = buildTestCases({
    statementMd: problem.statement_md ?? "",
    exampleTestcases: problem.examples,
    metaData: problem.meta_json,
  });

  if (parsed.cases.length === 0) {
    // Design problems ("implement a Trie", "design an LRU cache") have a different metadata
    // shape: a classname, a constructor, and a list of methods. The dataset has no suite for
    // them either, so say so plainly instead of leaking the internal reason "no params in
    // metaData", which reads like a bug.
    const meta = problem.meta_json ? (JSON.parse(problem.meta_json) as Record<string, unknown>) : {};
    if (typeof meta.classname === "string") {
      return c.json(
        {
          error:
            `${meta.classname} is a design problem: you implement a class with several methods, ` +
            `and it is exercised through a sequence of calls rather than one function. ` +
            `This runner grades single-function problems, so it cannot check your work here yet.`,
          designProblem: true,
          className: meta.classname,
        },
        422,
      );
    }

    // Nothing to grade and it is not a design problem: the examples are in a layout this
    // parser does not read. Flagged so the UI can explain instead of rendering a red failure.
    // It is a limitation of the runner, not a wrong answer from the student.
    if (parsed.parseWarning) {
      return c.json({ error: parsed.parseWarning, noGradeableTests: true }, 422);
    }

    return c.json({ error: "no runnable test cases for this problem", noGradeableTests: true }, 422);
  }

  const fnName = body.fnName ?? parsed.meta.name;
  const result = await runInLanguage({
    language,
    code: body.code,
    fnName,
    cases: parsed.cases,
    meta: parsed.meta,
  });

  return c.json({
    ...result,
    source: "examples",
    failedAssertion: null,
    parseWarning: parsed.parseWarning ?? null,
    // Surfaced on purpose: only exampleTestcases are public, so a green run here is not
    // a guarantee of passing LeetCode's hidden tests.
    //
    // Reaching this branch means the problem has no imported suite at all. The suite path
    // above handles every language, so this is not a language limitation. Saying "suites are
    // Python-only" here would be false and would send the student to switch languages for
    // nothing.
    disclaimer:
      "Graded against the public example cases only — no imported suite exists for this problem. " +
      "LeetCode's hidden tests are not in the API.",
  });
});

// ---------------------------------------------------------------------------
// Attempts + review
// ---------------------------------------------------------------------------

app.post("/api/attempts", async (c) => {
  const body = (await c.req.json()) as {
    slug: string;
    code: string;
    passed: boolean;
    testsPassed: number;
    testsTotal: number;
    hintsUsed: number;
    solutionUnlocked: boolean;
    seconds: number;
    language?: string;
  };

  const problem = db.query<{ qid: number }, [string]>("SELECT qid FROM problems WHERE slug = ?").get(body.slug);
  if (!problem) return c.json({ error: "unknown problem" }, 404);

  const grade = gradeAttempt({
    passed: body.passed,
    hintsUsed: body.hintsUsed,
    solutionUnlocked: body.solutionUnlocked,
    seconds: body.seconds,
  });

  const now = new Date();
  db.run(
    `INSERT INTO attempts (qid, started_at, ended_at, passed, tests_passed, tests_total,
                           hints_used, max_hint_level, solution_unlocked, seconds, code, language, grade)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      problem.qid,
      new Date(now.getTime() - body.seconds * 1000).toISOString(),
      now.toISOString(),
      body.passed ? 1 : 0,
      body.testsPassed,
      body.testsTotal,
      body.hintsUsed,
      0,
      body.solutionUnlocked ? 1 : 0,
      body.seconds,
      body.code,
      body.language ?? "python3",
      grade,
    ],
  );

  // Only schedule a card once the problem has actually been worked on.
  const schedule = body.passed || body.testsPassed > 0 ? reviewCard(problem.qid, grade, now) : null;

  // Mastery is derived from the attempt log, so it is recomputed, never incremented.
  // One person's history is small enough that a full rebuild is cheaper than the risk of a
  // derived table drifting from its source.
  recomputeMastery();

  return c.json({
    grade,
    nextDue: schedule?.due.toISOString() ?? null,
    intervalDays: schedule?.intervalDays ?? null,
  });
});

/**
 * Every item due for review, across every track.
 *
 * One list, not one section per kind: `kind` takes six values and three of them had no
 * reader at all, so their due dates were written and never read back. The row's `kind` tells
 * the client which track it belongs to and therefore where clicking it goes.
 */
app.get("/api/review", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 40), 200);
  return c.json({ due: dueItems(limit) });
});

/**
 * Schedule a pattern from an attempt the student just completed.
 *
 * Called by the client after `/api/attempts` succeeds, because the attempt has to exist
 * before its grade can be read. Not folded into `/api/attempts` because a problem belongs to
 * one pattern, and the pattern review is a separate act.
 */
app.post("/api/review/patterns/:pattern/grade", async (c) => {
  const pattern = decodeURIComponent(c.req.param("pattern"));
  const body = (await c.req.json().catch(() => ({}))) as { qid?: number };
  if (typeof body.qid !== "number") return c.json({ error: "qid is required" }, 400);

  const row = db
    .query<{ grade: number }, [number]>(
      "SELECT grade FROM attempts WHERE qid = ? AND grade IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .get(body.qid);
  if (!row) return c.json({ error: "no graded attempt for that problem" }, 404);

  const schedule = reviewPattern(pattern, row.grade as Grade);
  return c.json({ due: schedule.due.toISOString(), intervalDays: schedule.intervalDays });
});

// ---------------------------------------------------------------------------
// Tutor
// ---------------------------------------------------------------------------

/** Hint ceiling for this problem, from state only. Shown before the student asks. */
app.get("/api/tutor/:slug/status", (c) => {
  const slug = c.req.param("slug");
  const row = db.query<{ qid: number }, [string]>("SELECT qid FROM problems WHERE slug = ?").get(slug);
  if (!row) return c.json({ error: "unknown problem" }, 404);

  const attempts = db
    .query<{ attempts: number; unlocked: number; first_at: string | null }, [number]>(
      `SELECT COUNT(*) AS attempts, COALESCE(MAX(solution_unlocked), 0) AS unlocked, MIN(started_at) AS first_at
       FROM attempts WHERE qid = ?`,
    )
    .get(row.qid);

  const minutes = attempts?.first_at ? (Date.now() - new Date(attempts.first_at).getTime()) / 60_000 : 0;
  const state = {
    attempts: attempts?.attempts ?? 0,
    minutes: Math.max(0, minutes),
    solutionUnlocked: (attempts?.unlocked ?? 0) === 1,
  };

  const history = db
    .query<
      { ceiling: number; emitted_level: number | null; rejected: number; ts: string; cost_idr: number | null },
      [number]
    >(
      `SELECT ceiling, emitted_level, rejected, ts, cost_idr FROM tutor_turns
       WHERE attempt_id IN (SELECT id FROM attempts WHERE qid = ?)
       ORDER BY id DESC LIMIT 50`,
    )
    .all(row.qid);

  return c.json({
    ceiling: hintCeiling(state),
    reason: ceilingReason(state),
    attempts: state.attempts,
    minutes: Math.round(state.minutes),
    turns: history.length,
    // Over-blocking is a measured failure, so it is surfaced, not hidden.
    rejectedTurns: history.filter((h) => h.rejected === 1).length,
    costIdr: history.reduce((a, h) => a + (h.cost_idr ?? 0), 0),
  });
});

app.post("/api/tutor/:slug/ask", async (c) => {
  const slug = c.req.param("slug");
  const body = (await c.req.json().catch(() => ({}))) as { message?: string; attemptId?: number };

  const latest = db
    .query<{ id: number }, [string]>(
      "SELECT id FROM attempts WHERE qid = (SELECT qid FROM problems WHERE slug = ?) ORDER BY id DESC LIMIT 1",
    )
    .get(slug);

  try {
    const turn = await tutorTurn({
      slug,
      studentMessage: body.message ?? "",
      attemptId: body.attemptId ?? latest?.id ?? null,
    });
    return c.json(turn);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

/** Explicit, logged solution unlock. Raises the ceiling to 6 for this problem. */
app.post("/api/tutor/:slug/unlock", async (c) => {
  const slug = c.req.param("slug");
  const problem = db.query<{ qid: number }, [string]>("SELECT qid FROM problems WHERE slug = ?").get(slug);
  if (!problem) return c.json({ error: "unknown problem" }, 404);

  const now = new Date().toISOString();
  db.run(
    `INSERT INTO attempts (qid, started_at, ended_at, passed, tests_passed, tests_total,
                           hints_used, max_hint_level, solution_unlocked, seconds, code, language, grade)
     VALUES (?, ?, ?, NULL, NULL, NULL, 0, 6, 1, NULL, NULL, 'python3', 1)`,
    [problem.qid, now, now],
  );

  return c.json({ unlocked: true, ceiling: 6, note: "Unlock recorded. The review grade for this problem is now Again." });
});

app.post("/api/tutor/:slug/review", async (c) => {
  const slug = c.req.param("slug");
  const body = (await c.req.json()) as {
    code: string;
    passed: boolean;
    testsPassed: number;
    testsTotal: number;
    stderr?: string;
  };

  try {
    const review = await reviewAttempt({ slug, ...body });
    return c.json(review);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// ---------------------------------------------------------------------------
// System design
// ---------------------------------------------------------------------------

/** The prompt list. Summaries only; the answer keys never reach the client. */
app.get("/api/design", (c) => {
  return c.json({ prompts: listDesignPrompts() });
});

app.post("/api/design/start", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { slug?: string };
  if (typeof body.slug !== "string") return c.json({ error: "slug is required" }, 400);
  try {
    const sessionId = startDesignSession(body.slug);
    return c.json({ sessionId, session: loadSession(sessionId) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
});

/**
 * The round still in progress, or null.
 *
 * The client calls this on mount so a reload, the one event that would otherwise lose an
 * unfinished round, lands back on the work instead of on an empty prompt list.
 */
app.get("/api/design/resume", (c) => {
  return c.json({ session: latestOpenSession() });
});

/**
 * The design concept library, grouped. Bodies are fetched per concept, not listed: the list is
 * browsed by title and summary, and 61 bodies is not a payload to send for a list view.
 */
app.get("/api/design/concepts", (c) => {
  const all = listDesignConcepts();
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABEL[group],
    concepts: all.filter((x) => x.group === group),
  })).filter((g) => g.concepts.length > 0);
  return c.json({ groups: grouped, total: all.length });
});

/**
 * One concept's body, plus the probe families it answers, named instead of numbered.
 */
app.get("/api/design/concepts/item", (c) => {
  const slug = c.req.query("slug");
  if (!slug) return c.json({ error: "slug query parameter is required" }, 400);
  const concept = getDesignConcept(slug);
  if (!concept) return c.json({ error: "unknown concept" }, 404);
  return c.json({
    concept,
    probes: concept.probeFamilies.map((i) => PROBE_FAMILIES[i]?.name ?? null),
  });
});

app.post("/api/design/:id/turn", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "bad id" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { message?: string };

  try {
    const turn = await designTurn(id, body.message ?? "");
    return c.json({ turn, session: loadSession(id) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, msg.startsWith("unknown design session") ? 404 : 502);
  }
});

/** Persist one phase draft, so a reload does not lose work. */
app.post("/api/design/:id/draft", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "bad id" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as {
    phase?: string;
    text?: string;
  };
  if (typeof body.phase !== "string" || typeof body.text !== "string") {
    return c.json({ error: "phase and text are required" }, 400);
  }

  try {
    saveDraft(id, body.phase, body.text);
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, msg.startsWith("unknown design session") ? 404 : 400);
  }
});

/** Persist the sketch pad. Round-level, so it does not ride on a phase draft. */
app.post("/api/design/:id/sketch", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "bad id" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { shapes?: unknown };

  try {
    saveSketch(id, body.shapes);
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, msg.startsWith("unknown design session") ? 404 : 400);
  }
});

/**
 * Finish and grade the round.
 *
 * A round graded below the scheduling threshold still returns its scores; only the card is
 * withheld. Reporting nothing for a weak round would remove the feedback the round exists to
 * give, and the card is the part that has to be earned.
 */
app.post("/api/design/:id/finish", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "bad id" }, 400);

  try {
    const session = loadSession(id);
    const result = await gradeDesign(id);

    // Only a round that cleared the bottom band comes back for review, the same rule the DSA
    // path applies when nothing passed. A round scored `Again` is not evidence of a pattern
    // worth scheduling.
    let schedule: { due: string; intervalDays: number } | null = null;
    if (result.grade > 1) {
      const s = reviewDesign(session.slug, session.title, result.grade as Grade);
      schedule = { due: s.due.toISOString(), intervalDays: s.intervalDays };
    }

    // The bridge target, resolved through the component table so the language prefix comes
    // from the seeded row, not from an assumption here. A prompt whose component is not in
    // the catalogue simply has no bridge.
    const bridge = getDesignPrompt(session.slug)?.componentSlug ?? null;
    const component = bridge ? getComponent(`python3/${bridge}`) : null;
    return c.json({
      scores: result.scores,
      signals: result.signals,
      grade: result.grade,
      summary: result.summary,
      model: result.model,
      costIdr: result.costIdr,
      nextDue: schedule?.due ?? null,
      intervalDays: schedule?.intervalDays ?? null,
      // The bridge to the Build track. Sent only with the finished round, not in the prompt
      // list, because naming the component before the round would be a hint about the
      // design; the candidate is meant to arrive at it themselves.
      //
      // The slug is prefixed with the language so the Build view can open it directly: the
      // catalogue is keyed by `lang/slug`, and a bare slug would match nothing and land the
      // candidate on whichever component happens to be first. `component.slug` is already
      // prefixed by `getComponent`, so it is used as-is.
      componentSlug: component?.slug ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.startsWith("unknown design session")
      ? 404
      : msg === "session already graded"
        ? 409
        : 502;
    return c.json({ error: msg }, status);
  }
});

// ---------------------------------------------------------------------------
// Behavioral and stack tracks
// ---------------------------------------------------------------------------

/**
 * Registers the six routes for one prose kind. Two kinds, one implementation.
 *
 * Route order inside this function matters and matches the design section's precedent:
 * `/resume` and `/item` are registered before `/:id`, because Hono matches in registration
 * order and a parameter route would otherwise capture them and reject them as a bad id.
 */
function registerProseTrack(app: Hono, kind: ProseTrackKind): void {
  const base = `/api/tracks/${kind}`;

  /** The prompt list, grouped. Summaries only; the answer keys never reach the client. */
  app.get(base, (c) => {
    const groups = listTrackGroups(kind);
    return c.json({ groups, total: groups.reduce((n, g) => n + g.prompts.length, 0) });
  });

  /**
   * The attempt still in progress, or null.
   *
   * The client calls this on mount so a reload, the one event that would otherwise lose an
   * unfinished answer, lands back on the work instead of on an empty prompt list.
   *
   * Registered before `/:id`: Hono matches in registration order, so a later literal route
   * would be captured by the parameter route and rejected as a bad id.
   */
  app.get(`${base}/resume`, (c) => c.json({ session: latestOpenTrackSession(kind) }));

  /**
   * One prompt with its answer key.
   *
   * The answer key is served here, not in the list, because this is the point at which the
   * candidate has committed to answering: the list is a menu, and a menu that shipped the
   * `lookFor` bullets would be the answer key handed out before the question.
   *
   * Registered before `/:id` for the same reason `/resume` is.
   */
  app.get(`${base}/item`, (c) => {
    const slug = c.req.query("slug");
    if (!slug) return c.json({ error: "slug query parameter is required" }, 400);
    const prompt = getTrackPrompt(kind, slug);
    if (!prompt) return c.json({ error: "unknown prompt" }, 404);
    return c.json({ prompt });
  });

  app.post(`${base}/start`, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { slug?: string };
    if (typeof body.slug !== "string") return c.json({ error: "slug is required" }, 400);
    try {
      const sessionId = startTrackSession(kind, body.slug);
      return c.json({ sessionId, session: loadTrackSession(sessionId) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
    }
  });

  /** Persist the answer draft, so a reload does not lose work. */
  app.post(`${base}/:id/answer`, async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "bad id" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { answerMd?: string };
    if (typeof body.answerMd !== "string") return c.json({ error: "answerMd is required" }, 400);
    try {
      saveTrackAnswer(id, body.answerMd);
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, msg.startsWith("unknown track session") ? 404 : 400);
    }
  });

  /**
   * Grade the answer and schedule it.
   *
   * A 409 for an already-graded session, because the second submission is a real client bug
   * and not a transient failure: the row is finished and its grade would be overwritten by a
   * second, differently-seeded call.
   *
   * A grading failure is a 502 and leaves the session ungraded, so the answer is intact and can
   * be resubmitted. The same shape `gradeDesign` uses.
   */
  app.post(`${base}/:id/finish`, async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "bad id" }, 400);
    try {
      return c.json(await finishTrackSession(id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg.startsWith("unknown track session")
        ? 404
        : msg === "session already graded"
          ? 409
          : 502;
      return c.json({ error: msg }, status);
    }
  });
}

registerProseTrack(app, "behavioral");
registerProseTrack(app, "stack");

// ---------------------------------------------------------------------------
// SQL 50
// ---------------------------------------------------------------------------

/**
 * The problem list, in list order, with a solved marker.
 *
 * `statement` and the reference query are NOT here: the list is browsed, and the answer key
 * must never reach the client. `getSqlProblem` carries the statement and the schema, and the
 * reference query only ever appears in a run result, after a pass.
 */
app.get("/api/sql", (c) => {
  return c.json({ problems: listSqlProblems(), ...sqlProgress() });
});

/**
 * One problem: statement, normalized schema, seed rows.
 *
 * Addressed by a query parameter, like the concepts and components, so a `:slug` route cannot
 * collide with `/api/sql/run`. The slug has no slash, but the two endpoints would otherwise be
 * ambiguous the moment one is added.
 */
app.get("/api/sql/item", (c) => {
  const slug = c.req.query("slug");
  if (!slug) return c.json({ error: "slug query parameter is required" }, 400);

  try {
    const problem = getSqlProblem(slug);
    if (!problem) return c.json({ error: `unknown SQL problem: ${slug}` }, 404);
    return c.json(problem);
  } catch (e) {
    // A problem that was never fetched is a setup problem, not a bug: say which command fixes
    // it instead of returning a 500 the UI would render as a crash.
    return c.json({ error: String(e), notFetched: true }, 409);
  }
});

/**
 * Run a submission against a freshly seeded database.
 *
 * The verdict comes from executing the query, and the reference query is the oracle, so a
 * correct answer cannot be marked wrong by a hand-written expected-output parser. The attempt
 * is recorded here rather than through `/api/attempts`, because the SQL track's grade is
 * derived from the execution result and there is no client-side verdict to trust.
 */
app.post("/api/sql/run", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { slug?: string; query?: string; seconds?: number };
  if (!body.slug) return c.json({ error: "slug is required" }, 400);
  if (typeof body.query !== "string") return c.json({ error: "query is required" }, 400);

  try {
    const result = runSql(body.slug, body.query, body.seconds ?? 0);
    return c.json({
      ...result,
      disclaimer:
        "Executed against a local SQLite database seeded from the problem's own sample data. " +
        "The reference query is the oracle, and rows are compared as a multiset.",
    });
  } catch (e) {
    return c.json({ error: String(e) }, 422);
  }
});

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

app.get("/api/models", async (c) => {
  try {
    const catalog = await fetchCatalog(c.req.query("refresh") === "1");
    return c.json({
      roles: allRoleModels(),
      roleLabels: ROLE_LABEL,
      availableRoles: ROLES,
      models: catalog
        .slice()
        .sort((a, b) => {
          if (a.free !== b.free) return a.free ? -1 : 1;
          return (a.inputPerM ?? 0) - (b.inputPerM ?? 0);
        }),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

app.post("/api/models/roles", async (c) => {
  const body = (await c.req.json()) as { role?: string; model?: string | null };
  if (!body.role || !ROLES.includes(body.role as (typeof ROLES)[number])) {
    return c.json({ error: `role must be one of ${ROLES.join(", ")}` }, 400);
  }
  setRoleModel(body.role as (typeof ROLES)[number], body.model ?? null);
  return c.json({ ok: true, roles: allRoleModels() });
});

// ---------------------------------------------------------------------------
// Mastery, weakness, hint dependence
// ---------------------------------------------------------------------------

app.get("/api/mastery", (c) => {
  return c.json({
    patterns: masteryReport(),
    hintDependence: hintDependence(),
    stats: studyStats(),
  });
});

/**
 * The daily streak, derived from the cards that were scheduled.
 */
app.get("/api/streak", (c) => c.json(streakStats()));

/**
 * Weekly activity for the last twelve weeks.
 *
 * Twelve weeks is one training block: long enough that a gap is visible as a gap, short enough
 * that the bars still move week to week. Buckets are Monday-aligned so a week means the same
 * thing here as it does in the streak calendar, and the three numbers answer three different
 * questions that a single count would conflate — how much was solved (progress), how much was
 * attempted (work), and on how many days (consistency).
 *
 * `solved` counts DISTINCT problems with a passing attempt in the week, not passing attempts:
 * re-solving one problem five times is practice, but it is not five problems solved.
 *
 * Every bucket is emitted, including weeks with nothing in them. A week with no rows has to
 * appear as a zero-height bar; dropping it would silently compress the axis and make a two-week
 * gap look like continuous work.
 */
app.get("/api/progress/history", (c) => {
  const count = Math.min(Math.max(Number(c.req.query("weeks") ?? 12), 1), 52);

  const weeks = db
    .query<{ weekStart: string; solved: number; attempts: number; activeDays: number }, [number]>(
      `WITH RECURSIVE seq(i) AS (
         SELECT 0 UNION ALL SELECT i + 1 FROM seq WHERE i + 1 < ?
       ),
       weeks AS (
         -- Start of the week containing today, then back i weeks. SQLite's "weekday 1" modifier
         -- advances to the NEXT Monday and is a NO-OP when the date already IS Monday, so on Mondays
         -- every bucket was one week stale and the current week appeared in none of them. Measured:
         -- 2026-09-28 (Mon) gave weekStart 2026-09-21 while 2026-09-29 (Tue) gave 2026-09-28.
         --
         -- strftime %w is 0 for Sunday..6 for Saturday, so (w + 6) % 7 is days since Monday. This
         -- is the same arithmetic streak.ts uses for its calendar, and it agrees for every weekday.
         SELECT date('now', 'localtime', '-' || ((CAST(strftime('%w', 'now', 'localtime') AS INTEGER) + 6) % 7) || ' days',
                     '-' || (i * 7) || ' days') AS weekStart
         FROM seq
       )
       SELECT w.weekStart,
              (SELECT COUNT(DISTINCT a.qid) FROM attempts a
                WHERE a.passed = 1
                  AND date(a.ended_at, 'localtime') >= w.weekStart
                  AND date(a.ended_at, 'localtime') < date(w.weekStart, '+7 days')) AS solved,
              (SELECT COUNT(*) FROM attempts a
                WHERE date(a.ended_at, 'localtime') >= w.weekStart
                  AND date(a.ended_at, 'localtime') < date(w.weekStart, '+7 days')) AS attempts,
              (SELECT COUNT(*) FROM (
                 SELECT DISTINCT date(a.ended_at, 'localtime') AS day FROM attempts a
                 WHERE a.ended_at IS NOT NULL
                 UNION
                 SELECT DISTINCT date(last_review, 'localtime') FROM cards WHERE last_review IS NOT NULL
                 UNION
                 SELECT DISTINCT date(last_review, 'localtime') FROM item_cards WHERE last_review IS NOT NULL
               ) d
                WHERE d.day >= w.weekStart AND d.day < date(w.weekStart, '+7 days')) AS activeDays
       FROM weeks w
       ORDER BY w.weekStart ASC`,
    )
    .all(count);

  return c.json({ weeks });
});

/**
 * Every milestone with its earned state. Evaluates and awards on read, so a milestone reached
 * while the server was down still lands here.
 */
app.get("/api/milestones", (c) => c.json({ milestones: evaluateMilestones() }));

// ---------------------------------------------------------------------------
// Settings + reset
// ---------------------------------------------------------------------------

/**
 * Which API key the tutor will use, and where it comes from.
 *
 * The key itself is never returned. A last-4 preview is enough to confirm which key is in
 * play without putting a credential into a response body, a browser history entry, or a
 * screenshot.
 */
app.get("/api/settings", (c) => {
  const stored = getMeta("kenari_api_key");
  const fromEnv = Boolean(process.env.KENARI_API_KEY);
  return c.json({
    keySource: fromEnv ? "env" : stored ? "database" : "none",
    keyPreview: fromEnv ? "(from KENARI_API_KEY env var)" : stored ? `…${stored.slice(-4)}` : null,
  });
});

app.post("/api/settings/key", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { key?: string };
  const key = (body.key ?? "").trim();
  if (key.length === 0) return c.json({ error: "key is empty" }, 400);
  if (!key.startsWith("kn-")) return c.json({ error: "kenari keys start with kn-" }, 400);
  setMeta("kenari_api_key", key);
  return c.json({ ok: true, keyPreview: `…${key.slice(-4)}` });
});

app.delete("/api/settings/key", (c) => {
  db.run("DELETE FROM meta WHERE key = 'kenari_api_key'");
  return c.json({ ok: true });
});

/** What a reset would remove, and what it would keep. Shown before confirming. */
app.get("/api/reset/preview", (c) => {
  const count = (t: string) =>
    db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${t}`).get()?.n ?? 0;
  return c.json({
    clears: {
      attempts: count("attempts"),
      cards: count("cards"),
      tutor_turns: count("tutor_turns"),
      pattern_mastery: count("pattern_mastery"),
      item_cards: count("item_cards"),
      milestones: count("milestones"),
      design_sessions: count("design_sessions"),
      track_sessions: count("track_sessions"),
    },
    keeps: {
      problems: count("problems"),
      lists: count("lists"),
      company_problems: count("company_problems"),
      full_tests: count("full_tests"),
      model_roles: count("model_roles"),
    },
  });
});

/**
 * Clear all learning state.
 *
 * The catalog is untouched: re-importing it takes ~70s, and `model_roles` is a preference.
 * `items` rows are catalogue-derived (`ensureKindItem` recreates them) and hold no progress.
 * `design_sessions` and `track_sessions` go too: leaving them behind kept a cleared milestone
 * cleared only until the next read. `first-design-round` evaluates
 * `SELECT 1 FROM design_sessions WHERE grade IS NOT NULL AND grade > 1`, so the surviving row
 * re-awarded it. A half-written round also resumed through `latestOpenSession`.
 * `tutor_turns` goes before `attempts`: `tutor_turns.attempt_id REFERENCES attempts(id)`, and
 * with `foreign_keys = ON` the reverse order fails.
 */
app.post("/api/reset", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== "RESET") {
    return c.json({ error: 'send {"confirm":"RESET"} to confirm' }, 400);
  }

  const cleared: Record<string, number> = {};
  db.transaction(() => {
    for (const t of [
      "tutor_turns", "attempts", "cards", "item_cards", "pattern_mastery", "milestones",
      "design_sessions", "track_sessions",
    ]) {
      const n = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${t}`).get()?.n ?? 0;
      db.run(`DELETE FROM ${t}`);
      cleared[t] = n;
    }
  })();

  return c.json({ ok: true, cleared });
});

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

/**
 * Problems in a list, with everything the UI needs to sort, filter, and group:
 * pattern, topics, difficulty, acceptance rate, solved state, and whether a full test
 * suite exists. Doing this server-side keeps the client from re-fetching per filter.
 */
app.get("/api/lists/:name/problems", (c) => {
  const name = c.req.param("name");
  const limit = Math.min(Number(c.req.query("limit") ?? 500), 2000);

  const rows = db
    .query<
      {
        qid: number;
        slug: string;
        title: string;
        difficulty: string;
        position: number;
        solved: number;
        pattern: string | null;
        topics: string | null;
        acRate: number | null;
        attempts: number;
        hintsUsed: number | null;
      },
      [string, number]
    >(
      `SELECT p.qid, p.slug, p.title, p.difficulty, l.position, p.pattern, p.topics, p.ac_rate AS acRate,
              COALESCE((SELECT MAX(a.passed) FROM attempts a WHERE a.qid = p.qid), 0) AS solved,
              (SELECT COUNT(*) FROM attempts a WHERE a.qid = p.qid) AS attempts,
              (SELECT MAX(a.hints_used) FROM attempts a WHERE a.qid = p.qid) AS hintsUsed
       FROM lists l JOIN problems p ON p.qid = l.qid
       WHERE l.name = ? ORDER BY l.position ASC LIMIT ?`,
    )
    .all(name, limit);

  return c.json({ list: name, problems: rows });
});

/** Roadmap: every pattern with its problems, for the NeetCode-style view. */
app.get("/api/roadmap", (c) => {
  const listName = c.req.query("list") ?? "neetcode150";

  const rows = db
    .query<
      {
        pattern: string;
        qid: number;
        slug: string;
        title: string;
        difficulty: string;
        position: number;
        solved: number;
      },
      [string]
    >(
      `SELECT p.pattern, p.qid, p.slug, p.title, p.difficulty, l.position,
              COALESCE((SELECT MAX(a.passed) FROM attempts a WHERE a.qid = p.qid), 0) AS solved
       FROM lists l
       JOIN problems p ON p.qid = l.qid
       WHERE l.name = ? AND p.pattern IS NOT NULL
       ORDER BY l.position ASC`,
    )
    .all(listName);

  const byPattern = new Map<string, typeof rows>();
  for (const r of rows) {
    const bucket = byPattern.get(r.pattern) ?? [];
    bucket.push(r);
    byPattern.set(r.pattern, bucket);
  }

  const mastery = new Map(
    db
      .query<{ pattern: string; elo: number; attempts: number }, []>(
        "SELECT pattern, elo, attempts FROM pattern_mastery",
      )
      .all()
      .map((m) => [m.pattern, m]),
  );

  const priorities = patternPriorities();

  const patterns = [...byPattern.entries()].map(([pattern, problems]) => ({
    pattern,
    problems,
    total: problems.length,
    solved: problems.filter((p) => p.solved === 1).length,
    elo: mastery.get(pattern)?.elo ?? null,
    priority: priorities[pattern] ?? null,
  }));

  const RANK = { High: 0, Mid: 1, Low: 2 } as const;
  // High-weight patterns first, then weakest-first inside each band. A pattern with no card
  // sorts last: an unknown weight must not outrank a known High one. Elo stays the tiebreak,
  // so the roadmap still opens on what needs work within a band.
  patterns.sort((a, b) => {
    const ra = a.priority ? RANK[a.priority] : 3;
    const rb = b.priority ? RANK[b.priority] : 3;
    return ra - rb || (a.elo ?? 0) - (b.elo ?? 0);
  });

  return c.json({ list: listName, patterns });
});

/**
 * The reference card for one pattern.
 *
 * `pattern` is a query parameter, not a path segment: pattern names contain `&` and `/`
 * ("Arrays & Hashing", "Heap / Priority Queue"), so a `:pattern` route would need the client
 * to double-encode and would still 404 on a mis-encoded ampersand. Same reason the concept
 * endpoints are addressed by query.
 *
 * A pattern with no card returns `200 { ref: null }`, not 404: "no card yet" is a normal state
 * because the pattern vocabulary is ingested, and the client renders nothing for it.
 */
app.get("/api/reference/pattern", (c) => {
  const pattern = c.req.query("pattern");
  if (!pattern) return c.json({ error: "pattern is required" }, 400);
  return c.json({ ref: getPatternRefView(pattern, c.req.query("list") ?? "neetcode150") });
});

app.get("/api/companies", (c) => {
  const rows = db
    .query<{ company: string; n: number }, []>(
      "SELECT company, COUNT(*) AS n FROM company_problems GROUP BY company ORDER BY n DESC",
    )
    .all();
  return c.json({ companies: rows });
});

app.get("/api/companies/:name/problems", (c) => {
  const name = c.req.param("name");
  const limit = Math.min(Number(c.req.query("limit") ?? 60), 300);

  const rows = db
    .query<
      {
        qid: number;
        slug: string;
        title: string;
        difficulty: string;
        frequency: number | null;
        pattern: string | null;
        solved: number;
      },
      [string, number]
    >(
      `SELECT p.qid, p.slug, p.title, p.difficulty, c.frequency, p.pattern,
              COALESCE((SELECT MAX(a.passed) FROM attempts a WHERE a.qid = p.qid), 0) AS solved
       FROM company_problems c
       JOIN problems p ON p.qid = c.qid
       WHERE c.company = ?
       ORDER BY c.frequency DESC NULLS LAST, p.difficulty
       LIMIT ?`,
    )
    .all(name, limit);

  return c.json({ company: name, problems: rows });
});

app.get("/api/languages", async (c) => {
  const available = await detectAvailableLanguages();
  return c.json({
    languages: LANGUAGES.map((l) => ({ id: l.id, label: l.label, langSlug: l.langSlug, available: available[l.id] ?? false })),
  });
});

// ---------------------------------------------------------------------------
// Fundamentals (pre-DSA concepts)
// ---------------------------------------------------------------------------

/**
 * Concepts grouped into modules, in teaching order.
 *
 * The slug contains a slash (`python3/2d-array-init`) and Hono route parameters do not match
 * across `/`, so the item is addressed by a query parameter. A `:slug` route would 404 on every
 * real slug; a wildcard would swallow `/api/concepts/run`.
 */
app.get("/api/concepts", (c) => {
  const lang = c.req.query("lang") ?? undefined;
  return c.json({
    lang: lang ?? null,
    languages: LANGS,
    langLabels: LANG_LABEL,
    modules: conceptModules(lang),
    total: listConcepts(lang).length,
  });
});

app.get("/api/concepts/item", (c) => {
  const slug = c.req.query("slug");
  if (!slug) return c.json({ error: "slug query parameter is required" }, 400);

  const concept = getConcept(slug);
  if (!concept) return c.json({ error: `unknown concept: ${slug}` }, 404);

  return c.json({ ...concept, gradeLimitSeconds: GRADE_LIMIT_SECONDS });
});

/**
 * Run a submission against a concept's tests.
 *
 * Graded by the same executor the DSA problems use, and on a pass the concept is scheduled
 * through `item_cards` with the same behavioural grade: there is no self-rating anywhere in
 * this app, and a concept is not an exception.
 */
app.post("/api/concepts/run", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { slug?: string; code?: string; seconds?: number };
  if (!body.slug) return c.json({ error: "slug is required" }, 400);
  if (typeof body.code !== "string") return c.json({ error: "code is required" }, 400);

  const concept = getConcept(body.slug);
  if (!concept) return c.json({ error: `unknown concept: ${body.slug}` }, 404);

  const result = await runConcept(body.slug, body.code);
  const schedule = recordConcept(
    body.slug,
    { accepted: result.accepted, passed: result.passed, total: result.total },
    body.seconds ?? 0,
  );

  return c.json({
    ...result,
    disclaimer:
      `${result.total} test case${result.total === 1 ? "" : "s"} executed locally. ` +
      `Same runner as the DSA problems.`,
    grade: schedule.grade,
    nextDue: schedule.due,
    intervalDays: schedule.intervalDays,
  });
});

// ---------------------------------------------------------------------------
// Components (executable system design)
// ---------------------------------------------------------------------------

/**
 * Components grouped into modules, in teaching order.
 *
 * Addressed by a query parameter for the same reason the concepts are: the slug contains a slash
 * (`python3/lru-cache`) and a `:slug` route would 404 on every real slug, while a wildcard
 * would swallow `/api/components/run`.
 */
app.get("/api/components", (c) => {
  const lang = c.req.query("lang") ?? undefined;
  return c.json({
    lang: lang ?? null,
    languages: COMPONENT_LANGS,
    langLabels: COMPONENT_LANG_LABEL,
    modules: componentModules(lang),
    total: listComponents(lang).length,
  });
});

app.get("/api/components/item", (c) => {
  const slug = c.req.query("slug");
  if (!slug) return c.json({ error: "slug query parameter is required" }, 400);

  const component = getComponent(slug);
  if (!component) return c.json({ error: `unknown component: ${slug}` }, 404);

  return c.json({ ...component, gradeLimitSeconds: GRADE_LIMIT_SECONDS });
});

/**
 * Run a submission against a component's tests.
 *
 * Graded by the same executor the DSA problems and concepts use, and on a pass the component
 * is scheduled through `item_cards` with the same behavioural grade.
 */
app.post("/api/components/run", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { slug?: string; code?: string; seconds?: number };
  if (!body.slug) return c.json({ error: "slug is required" }, 400);
  if (typeof body.code !== "string") return c.json({ error: "code is required" }, 400);

  const component = getComponent(body.slug);
  if (!component) return c.json({ error: `unknown component: ${body.slug}` }, 404);

  const result = await runComponent(body.slug, body.code);
  const schedule = recordComponent(
    body.slug,
    { accepted: result.accepted, passed: result.passed, total: result.total },
    body.seconds ?? 0,
  );

  return c.json({
    ...result,
    disclaimer:
      `${result.total} test case${result.total === 1 ? "" : "s"} executed locally. ` +
      `Same runner as the DSA problems.`,
    grade: schedule.grade,
    nextDue: schedule.due,
    intervalDays: schedule.intervalDays,
  });
});

// ---------------------------------------------------------------------------
// The UI
// ---------------------------------------------------------------------------

/**
 * Serve the built UI from this process.
 *
 * This is the one-action startup. Before it, running the app took two terminals — the API on
 * 5173 and `vite` on 5174 — and opening the wrong one showed a blank page. One process now
 * answers both, so `bun run start:ui` is the whole instruction.
 *
 * Registered AFTER every `/api/*` route, deliberately: `serveStatic` is mounted on `/*` and
 * Hono matches in registration order, so a static handler registered first would try to serve
 * `/api/review` as a file and 404 it.
 *
 * Two registrations, not one. The wildcard serves real files (`/assets/logo.svg`,
 * `/main-abc123.js`); the second answers every other path with `index.html`, which is what makes
 * a deep link like `/settings` work on a fresh load rather than 404. The app has no router, but
 * a reload on any URL still has to boot.
 *
 * A missing `dist/ui` is not fatal: the API is useful on its own (and is what the tests drive),
 * so this logs the one command that fixes it and carries on.
 */
if (existsSync(UI_DIR)) {
  app.use("/*", serveStatic({ root: UI_DIR }));
  app.get("*", serveStatic({ path: join(UI_DIR, "index.html") }));
} else {
  console.log(`[prep] no built UI at ${UI_DIR} — run \`bun run build:ui\` to serve the app from this port`);
}

const PORT = Number(process.env.PORT ?? 5173);

console.log(`[prep] http://localhost:${PORT}`);
console.log(
  `[prep] ${db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM problems").get()?.n ?? 0} problems loaded`,
);

export default { port: PORT, fetch: app.fetch, hostname: "127.0.0.1" };
