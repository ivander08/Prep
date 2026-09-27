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
import { fetchProblem, htmlToMarkdown } from "./leetcode.ts";
import { buildTestCases, runPython } from "./executor.ts";
import { dueQueue, nextUnsolved, listProgress, reviewCard, gradeAttempt } from "./srs.ts";
import { tutorTurn, reviewAttempt } from "./tutor/index.ts";
import { hintCeiling, ceilingReason } from "./tutor/policy.ts";

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

app.get("/api/lists/:name/problems", (c) => {
  const name = c.req.param("name");
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);

  const rows = db
    .query<
      { qid: number; slug: string; title: string; difficulty: string; position: number; solved: number },
      [string, number]
    >(
      `SELECT p.qid, p.slug, p.title, p.difficulty, l.position,
              COALESCE((SELECT MAX(a.passed) FROM attempts a WHERE a.qid = p.qid), 0) AS solved
       FROM lists l JOIN problems p ON p.qid = l.qid
       WHERE l.name = ? ORDER BY l.position ASC LIMIT ?`,
    )
    .all(name, limit);

  return c.json({ list: name, problems: rows });
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
    hints: JSON.parse(hints ?? "[]") as string[],
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
  const body = (await c.req.json()) as { slug: string; code: string; fnName?: string };
  const problem = db
    .query<{ meta_json: string | null; statement_md: string | null; examples: string | null }, [string]>(
      "SELECT meta_json, statement_md, examples FROM problems WHERE slug = ?",
    )
    .get(body.slug);

  if (!problem?.statement_md) return c.json({ error: "problem not loaded — open it first" }, 400);

  const parsed = buildTestCases({
    statementMd: problem.statement_md,
    exampleTestcases: problem.examples,
    metaData: problem.meta_json,
  });

  if (parsed.cases.length === 0) {
    return c.json({ error: parsed.parseWarning ?? "no runnable test cases", parseWarning: true }, 422);
  }

  const fnName = body.fnName ?? parsed.meta.name;
  const result = await runPython({ code: body.code, fnName, cases: parsed.cases });

  return c.json({
    ...result,
    parseWarning: parsed.parseWarning ?? null,
    // Surfaced deliberately: only exampleTestcases are public, so a green run here is not
    // a guarantee of passing LeetCode's hidden tests.
    disclaimer: "Graded against public example cases only. LeetCode's hidden tests are not in the API.",
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
