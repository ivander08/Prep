/**
 * Prep — local interview prep server.
 *
 * Single-user, local-only. No auth, no accounts, no hosting: the app binds to 127.0.0.1
 * and everything lives in one SQLite file. That is a deliberate choice, not a shortcut —
 * it keeps problem statements cached locally instead of redistributed, which is what makes
 * using LeetCode's API defensible (dossier §10).
 */

import { Hono } from "hono";
import { db, migrate, getMeta } from "./db.ts";
import { fetchProblem, htmlToMarkdown, hintToMarkdown } from "./leetcode.ts";
import { buildTestCases, runFullTests, type FullTestRow, type ProblemMeta } from "./executor.ts";
import { runSuite } from "./grading.ts";
import { runInLanguage } from "./runner.ts";
import { LANGUAGES, detectAvailableLanguages } from "./languages.ts";
import { dueQueue, nextUnsolved, listProgress, reviewCard, gradeAttempt } from "./srs.ts";
import { tutorTurn, reviewAttempt } from "./tutor/index.ts";
import { hintCeiling, ceilingReason } from "./tutor/policy.ts";
import { fetchCatalog, allRoleModels, setRoleModel, ROLE_LABEL, ROLES } from "./models.ts";
import { masteryReport, hintDependence, studyStats, recomputeMastery } from "./mastery.ts";

migrate();

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
        statement_md: string | null;
        hints: string | null;
        snippets: string | null;
        meta_json: string | null;
        examples: string | null;
      },
      [string]
    >(
      `SELECT qid, slug, title, difficulty, topics, statement_md, hints, snippets, meta_json, examples
       FROM problems WHERE slug = ?`,
    )
    .get(slug);

  if (!row) return c.json({ error: "problem not found" }, 404);

  let { statement_md: statementMd, hints, snippets, meta_json: metaJson, examples } = row;

  if (!statementMd) {
    try {
      const detail = await fetchProblem(slug);
      statementMd = htmlToMarkdown(detail.content ?? "");
      hints = JSON.stringify(detail.hints ?? []);
      snippets = JSON.stringify(detail.codeSnippets ?? []);
      metaJson = detail.metaData ?? "{}";
      examples = detail.exampleTestcases ?? "";

      db.run(
        `UPDATE problems SET statement_md = ?, hints = ?, snippets = ?, meta_json = ?, examples = ?,
                             fetched_at = ? WHERE qid = ?`,
        [statementMd, hints, snippets, metaJson, examples, new Date().toISOString(), row.qid],
      );
    } catch (e) {
      return c.json({ error: `failed to fetch statement: ${String(e)}` }, 502);
    }
  }

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

  return c.json({
    qid: row.qid,
    slug: row.slug,
    title: row.title,
    difficulty: row.difficulty,
    topics: (row.topics ?? "").split(",").filter(Boolean),
    statementMd,
    hints: (JSON.parse(hints ?? "[]") as string[]).map(hintToMarkdown),
    snippets: JSON.parse(snippets ?? "[]") as Array<{ langSlug: string; code: string }>,
    meta: parsed.meta,
    testCases: parsed.cases.map((tc) => ({ args: tc.args, expected: tc.expected })),
    parseWarning: parsed.parseWarning ?? null,
    card: card ?? null,
  });
});

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

app.post("/api/run", async (c) => {
  const body = (await c.req.json()) as { slug: string; code: string; fnName?: string; language?: string };
  const problem = db
    .query<{ meta_json: string | null; statement_md: string | null; examples: string | null }, [string]>(
      "SELECT meta_json, statement_md, examples FROM problems WHERE slug = ?",
    )
    .get(body.slug);

  if (!problem?.statement_md) return c.json({ error: "problem not loaded — open it first" }, 400);

  const language = body.language ?? "python3";

  // Prefer the imported full test suite. It is a third-party proxy, not LeetCode's own
  // tests, but it is 37-144 executable assertions instead of 2-3 public examples, so it
  // catches far more.
  //
  // The dataset's suites are Python `assert` statements calling a Python entry point, so
  // they only apply to Python submissions. For other languages the run falls back to the
  // parsed example cases — which is a genuine limitation, not an oversight, and the
  // disclaimer says so.
  const suite =
    language === "python3"
      ? db
          .query<FullTestRow, [string]>(
            "SELECT slug, entry_point, prelude, test_body, io_cases FROM full_tests WHERE slug = ?",
          )
          .get(body.slug)
      : null;

  // Structured I/O grading supersedes the assert-based path for Python: it can apply a
  // semantic verifier, so a correct solution that orders its answer differently is accepted
  // rather than rejected.
  if (language === "python3" && suite?.io_cases) {
    const meta = problem.meta_json ? (JSON.parse(problem.meta_json) as ProblemMeta) : null;
    const graded = await runSuite({
      slug: body.slug,
      code: body.code,
      fnName: body.fnName ?? meta?.name ?? "",
      ioJson: suite.io_cases,
      meta,
    });

    return c.json({
      source: "suite",
      accepted: graded.accepted,
      passed: graded.passed,
      total: graded.total,
      skipped: graded.skipped,
      semantic: graded.semanticCount > 0,
      durationMs: graded.durationMs,
      cases: graded.cases.slice(0, 40).map((c) => ({
        index: c.index,
        args: [c.input],
        expected: c.expected,
        got: c.got,
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

  if (suite) {
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
    statementMd: problem.statement_md,
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

    return c.json({ error: parsed.parseWarning ?? "no runnable test cases", parseWarning: true }, 422);
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
    disclaimer:
      language === "python3"
        ? "Graded against the public example cases only — no full suite was found for this problem. " +
          "LeetCode's hidden tests are not in the API."
        : `Graded against the public example cases only. Full test suites are Python-only ` +
          `(the dataset ships Python assertions), so ${language} submissions use the examples. ` +
          `Switch to Python for the 80-assertion suite.`,
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

app.get("/api/review", (c) => {
  const list = c.req.query("list") ?? null;
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
  return c.json({ due: dueQueue(list, limit) });
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
        hasFullTests: number;
      },
      [string, number]
    >(
      `SELECT p.qid, p.slug, p.title, p.difficulty, l.position, p.pattern, p.topics, p.ac_rate AS acRate,
              COALESCE((SELECT MAX(a.passed) FROM attempts a WHERE a.qid = p.qid), 0) AS solved,
              (SELECT COUNT(*) FROM attempts a WHERE a.qid = p.qid) AS attempts,
              (SELECT MAX(a.hints_used) FROM attempts a WHERE a.qid = p.qid) AS hintsUsed,
              CASE WHEN EXISTS (SELECT 1 FROM full_tests f WHERE f.slug = p.slug) THEN 1 ELSE 0 END AS hasFullTests
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

  const patterns = [...byPattern.entries()].map(([pattern, problems]) => ({
    pattern,
    problems,
    total: problems.length,
    solved: problems.filter((p) => p.solved === 1).length,
    elo: mastery.get(pattern)?.elo ?? null,
  }));

  // Patterns with no attempts sort first so the roadmap opens on what needs work.
  patterns.sort((a, b) => (a.elo ?? 0) - (b.elo ?? 0));

  return c.json({ list: listName, patterns });
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
