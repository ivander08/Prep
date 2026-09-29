/**
 * Prep — local interview prep server.
 *
 * Single-user, local-only. No auth, no accounts, no hosting: the app binds to 127.0.0.1
 * and everything lives in one SQLite file. That is a deliberate choice, not a shortcut —
 * it keeps problem statements cached locally instead of redistributed, which is what makes
 * using LeetCode's API defensible (dossier §10).
 */

import { Hono } from "hono";
import { db, migrate, getMeta, setMeta } from "./db.ts";
import { fetchProblem, htmlToMarkdown, hintToMarkdown } from "./leetcode.ts";
import { buildTestCases, runFullTests, type FullTestRow, type ProblemMeta } from "./executor.ts";
import { hasStructuredSuite, runSuiteAnyLanguage } from "./grading.ts";
import { runInLanguage } from "./runner.ts";
import { LANGUAGES, detectAvailableLanguages } from "./languages.ts";
import { dueItems, duePatterns, nextUnsolved, listProgress, reviewCard, reviewPattern, reviewDesign, gradeAttempt, GRADE_LIMIT_SECONDS } from "./srs.ts";
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

migrate();

// The concept catalogue is code, so it is seeded on every boot rather than migrated: an edit
// to the prose or an exemplar then takes effect on reload instead of needing a new migration.
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
 * Problem detail. The statement is fetched from LeetCode on first open and cached in
 * SQLite forever after — one network call per problem, ever.
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
   * returns `content: null`, so it stores an empty statement — and an empty string is
   * falsy, which made every open of a locked problem re-fetch from LeetCode. That is a
   * network call per page view for a result that cannot change.
   *
   * A manually pasted statement is also exempt: `statement_source = 'manual'` means the user
   * wrote it, and a later fetch would silently replace their text with nothing.
   */
  if (row.fetched_at === null && statementSource !== "manual") {
    try {
      const detail = await fetchProblem(slug);
      statementMd = detail.content ? htmlToMarkdown(detail.content) : "";
      statementSource = detail.content ? "leetcode" : null;
      hints = JSON.stringify(detail.hints ?? []);
      snippets = JSON.stringify(detail.codeSnippets ?? []);
      metaJson = detail.metaData ?? "{}";
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

  // Premium-only and no prose. The tests still work — 375 Premium problems have imported
  // suites, and `exampleTestcases`/`metaData` come back unauthenticated — so this is not an
  // error, it is one missing piece of the page. The signal is precise: examples came back
  // but the statement did not, which is exactly the Premium response shape.
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
    // ACCEPTED verdict reads as a contradiction.
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
 * `got` is unbounded — it is whatever the student's code returned — so one wrong answer that
 * builds a large structure can serialise to megabytes for a single case (measured: 1.3 MB
 * for one case of a 400x40 string matrix). Grading happens on the raw value BEFORE this
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

  // NOTE: an empty `statement_md` is NOT a reason to refuse. A Premium problem stores an
  // empty statement by design and still has a usable suite — refusing here would make 375
  // gradeable Premium problems unrunnable.

  const language = body.language ?? "python3";

  // Prefer the imported full test suite: 37-144 executable cases instead of 2-3 public
  // examples, so it catches far more.
  //
  // This is NOT Python-only, and it never needed to be. `io_cases` is a JSON array of
  // `{input: "nums = [3,3]", output: "[0,1]"}` pairs and both sides are parsed in TypeScript,
  // so the cases are language-agnostic — only the dataset's generated `check()` asserts are
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
      fnName: body.fnName ?? meta?.name ?? "",
      ioJson: suite.io_cases,
      meta,
      language,
    });

    return c.json({
      source: "suite",
      accepted: graded.accepted,
      passed: graded.passed,
      total: graded.total,
      skipped: graded.skipped,
      semantic: graded.semanticCount > 0,
      durationMs: graded.durationMs,
      // Every case, not the first 40. A suite runs up to 128 (sort-colors) and a truncated
      // list silently hides the failing case the student is looking for — the count line
      // said "18/72" while only 40 were ever rendered.
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

  // A suite with no parsed `io_cases` can still be run, but only in Python — the dataset
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
    // shape: a classname, a constructor, and a list of methods, rather than one function.
    // The dataset has no suite for them either, so say so plainly instead of leaking the
    // internal reason "no params in metaData", which reads like a bug.
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
    // parser does not read. Flagged so the UI can explain rather than render a red failure —
    // it is a limitation of the runner, not a wrong answer from the student.
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
    // Surfaced deliberately: only exampleTestcases are public, so a green run here is not
    // a guarantee of passing LeetCode's hidden tests.
    //
    // Reaching this branch means the problem has NO imported suite at all — the suite path
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

  // Mastery is derived from the attempt log, so it is recomputed rather than incremented.
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
 * One list rather than one section per kind: `kind` takes six values and three of them had no
 * reader at all, so their due dates were written and never read back. The row's `kind` tells
 * the client which track it belongs to and therefore where clicking it goes.
 */
app.get("/api/review", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 40), 200);
  return c.json({ due: dueItems(limit) });
});

/** Patterns due for review, each with a representative problem to re-solve. */
app.get("/api/review/patterns", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 10), 50);
  return c.json({ due: duePatterns(limit) });
});

/**
 * Schedule a pattern from an attempt the student just completed.
 *
 * Called by the client after `/api/attempts` succeeds, because the attempt has to exist
 * before its grade can be read. Not folded into `/api/attempts` because a problem belongs to
 * exactly one pattern and the pattern review is a separate, deliberate act.
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

app.get("/api/next", (c) => {
  const list = c.req.query("list") ?? "neetcode150";
  return c.json({ next: nextUnsolved(list, Math.min(Number(c.req.query("limit") ?? 10), 50)) });
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
    // Over-blocking is a measured failure, so surface it rather than hiding it.
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

/** The prompt list. Summaries only — the answer keys never reach the client. */
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
 * The client calls this on mount so a reload — the one event that would otherwise lose an
 * unfinished round — lands back on the work rather than on an empty prompt list.
 *
 * Registered BEFORE `/api/design/:id`: Hono matches in registration order, so a later
 * literal route would be captured by the parameter route and rejected as a bad id.
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
 * One concept's body, plus the probe families it answers named rather than numbered.
 *
 * Registered BEFORE `/api/design/:id` for the same reason `/api/design/resume` is: Hono matches
 * in registration order, so a later literal route would be captured by the parameter route and
 * rejected as a bad id. The `/item` route does not strictly need the ordering (two segments),
 * but registering both together keeps the rule visible.
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

app.get("/api/design/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "bad id" }, 400);
  try {
    return c.json({ session: loadSession(id) });
  } catch {
    return c.json({ error: "unknown design session" }, 404);
  }
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

    // Only a round that cleared the bottom band comes back for review — the same rule the DSA
    // path applies when nothing passed. A round scored `Again` is not evidence of a pattern
    // worth scheduling.
    let schedule: { due: string; intervalDays: number } | null = null;
    if (result.grade > 1) {
      const s = reviewDesign(session.slug, session.title, result.grade as Grade);
      schedule = { due: s.due.toISOString(), intervalDays: s.intervalDays };
    }

    // The bridge target, resolved through the component table so the language prefix comes
    // from the seeded row rather than being assumed here. A prompt whose component is not in
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
      // The bridge to the Build track. Sent only with the finished round rather than in the
      // prompt list, because naming the component before the round would be a hint about the
      // design — the candidate is meant to arrive at it themselves.
      //
      // The slug is prefixed with the language so the Build view can open it directly: the
      // catalogue is keyed by `lang/slug`, and a bare slug would silently fail to match and
      // land the candidate on whichever component happens to be first. `component.slug` is
      // already prefixed by `getComponent`, so it is used as-is rather than prefixed again.
      componentSlug: component?.slug ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, msg.startsWith("unknown design session") ? 404 : 502);
  }
});

// ---------------------------------------------------------------------------
// Behavioral and stack tracks
// ---------------------------------------------------------------------------

/**
 * Registers the six routes for one prose kind. Two kinds, one implementation.
 *
 * Route order inside this function is load-bearing and matches the design section's precedent:
 * `/resume` and `/item` are registered BEFORE `/:id`, because Hono matches in registration
 * order and a parameter route would otherwise capture them and reject them as a bad id.
 */
function registerProseTrack(app: Hono, kind: ProseTrackKind): void {
  const base = `/api/tracks/${kind}`;

  /** The prompt list, grouped. Summaries only — the answer keys never reach the client. */
  app.get(base, (c) => {
    const groups = listTrackGroups(kind);
    return c.json({ groups, total: groups.reduce((n, g) => n + g.prompts.length, 0) });
  });

  /**
   * The attempt still in progress, or null.
   *
   * The client calls this on mount so a reload — the one event that would otherwise lose an
   * unfinished answer — lands back on the work rather than on an empty prompt list.
   *
   * Registered BEFORE `/:id`: Hono matches in registration order, so a later literal route
   * would be captured by the parameter route and rejected as a bad id.
   */
  app.get(`${base}/resume`, (c) => c.json({ session: latestOpenTrackSession(kind) }));

  /**
   * One prompt WITH its answer key.
   *
   * The answer key is served here rather than in the list because this is the point at which
   * the candidate has committed to answering: the list is a menu, and a menu that shipped the
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
   * rather than a transient failure — the row is finished and its grade would be overwritten
   * by a second, differently-seeded call.
   *
   * A grading failure is a 502 and leaves the session UNGRADED, so the answer is intact and can
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

app.post("/api/mastery/recompute", (c) => {
  const n = recomputeMastery();
  return c.json({ ok: true, patterns: n });
});

/** The daily streak, derived from the cards that were scheduled. */
app.get("/api/streak", (c) => c.json(streakStats()));

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
 * The catalog (problems, lists, company tags, test suites) is untouched — re-importing it
 * takes ~70s and there is no reason to make the user wait for a reset of their own
 * progress. `model_roles` is also kept: it is a preference, not progress.
 *
 * Deleting `tutor_turns` before `attempts` matters — the foreign key is
 * `tutor_turns.attempt_id REFERENCES attempts(id)`, and with `foreign_keys = ON` the
 * reverse order fails.
 *
 * `design_sessions` and `track_sessions` go too. Leaving them behind kept a cleared
 * milestone cleared only until the next read: `first-design-round` evaluates
 * `SELECT 1 FROM design_sessions WHERE grade IS NOT NULL AND grade > 1`, so the surviving
 * row re-awarded the milestone the user had just reset. A half-written round also still
 * resumed through `latestOpenSession`. Neither table is referenced by a foreign key, so
 * their position in the list is free.
 *
 * `items` is not in the list. Its rows are catalogue-derived (`ensureKindItem` recreates
 * them on demand) and hold no progress.
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
 * `pattern` is a QUERY parameter, not a path segment: pattern names contain `&` and `/`
 * ("Arrays & Hashing", "Heap / Priority Queue"), so a `:pattern` route would need the client
 * to double-encode and would still 404 on a mis-encoded ampersand. Same reason the concept
 * endpoints are addressed by query.
 *
 * A pattern with no card returns `200 { ref: null }`, not 404 — "no card yet" is a normal state
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
 * across `/`, so the item is addressed by QUERY parameter rather than a path parameter. A
 * `:slug` route would 404 on every real slug; a wildcard would swallow `/api/concepts/run`.
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
 * through `item_cards` with the same behavioural grade — there is no self-rating anywhere in
 * this app and a concept is not an exception.
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
 * Addressed by QUERY parameter for the same reason the concepts are: the slug contains a slash
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

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    problems: db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM problems").get()?.n ?? 0,
    lists: db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM lists").get()?.n ?? 0,
    ingestedAt: getMeta("ingested_at"),
  }),
);

const PORT = Number(process.env.PORT ?? 5173);

console.log(`[prep] http://localhost:${PORT}`);
console.log(
  `[prep] ${db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM problems").get()?.n ?? 0} problems loaded`,
);

export default { port: PORT, fetch: app.fetch, hostname: "127.0.0.1" };
