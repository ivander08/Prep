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
