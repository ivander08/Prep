/**
 * SQL 50 ingest: fetch and store the statement, schema and seed rows for every problem in the
 * `sql50` list.
 *
 * The DSA path (`src/server/index.ts`) fetches a statement lazily on first open, because a
 * catalog of 4,068 is not worth pre-fetching. The SQL track is 50 problems and every one of
 * them is graded by executing the candidate's query against a locally seeded database, so
 * there is no useful state where a SQL problem is listed but not solvable. Fetch all 50 up
 * front, once, into the same columns the lazy path fills.
 *
 * Three things measured against the live API that shape this file:
 *
 * 1. `exampleTestcases` for SQL carries BOTH the DDL seed rows and, in `metaData.mysql`, the
 *    `CREATE TABLE` statements. A DSA problem's `exampleTestcases` is arguments; this is a
 *    whole database.
 * 2. `exampleTestcases` is NEWLINE-DELIMITED when a problem has more than one case. Three of
 *    the 50 have two cases, and `JSON.parse` on the whole string throws `Unable to parse JSON
 *    string` for exactly those three. Split on newlines first.
 * 3. `codeSnippets` for SQL is only a comment stub (`# Write your MySQL query statement
 *    below`), so the stored snippets are kept for completeness and the editor's starter text
 *    comes from the UI instead.
 *
 * Run: `bun run ingest:sql`
 */

import { db, migrate } from "../db.ts";
import { fetchSqlProblem, htmlToMarkdown, POLITE_DELAY_MS } from "../leetcode.ts";

/** The 50 slugs, in list order. `sql50` is the list name; LeetCode's plan slug is `top-sql-50`. */
function sql50Slugs(): string[] {
  return db
    .query<{ slug: string }, []>(
      `SELECT p.slug FROM lists l JOIN problems p ON p.qid = l.qid
       WHERE l.name = 'sql50' ORDER BY l.position ASC`,
    )
    .all()
    .map((r) => r.slug);
}

/**
 * Parse the newline-delimited `exampleTestcases` blob into one entry per case.
 *
 * A single-case problem returns one JSON object; a two-case problem returns two JSON objects
 * separated by a newline. Splitting unconditionally handles both, and the split is the only
 * form that works for the three two-case problems.
 */
export function parseSqlCases(raw: string): Array<{
  headers: Record<string, string[]>;
  rows: Record<string, Array<Array<string | number | null>>>;
}> {
  const lines = raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  return lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`exampleTestcases line was not JSON: ${line.slice(0, 120)} (${String(e)})`);
    }
  });
}

async function ingestOne(slug: string, index: number, total: number): Promise<"stored" | "skipped"> {
  const row = db
    .query<{ qid: number; fetched_at: string | null }, [string]>(
      "SELECT qid, fetched_at FROM problems WHERE slug = ?",
    )
    .get(slug);
  if (!row) throw new Error(`slug not in the local catalog: ${slug}`);

  // Idempotent: a stored row is a fetch that already happened. `--force` re-fetches, which is
  // what a re-run wants after a parser fix.
  if (row.fetched_at !== null && !process.argv.includes("--force")) return "skipped";

  const detail = await fetchSqlProblem(slug);

  if (detail.isPaidOnly) {
    // Not an error state to store: a Premium SQL problem has no seed data and cannot be
    // graded by execution, so the row stays unfetched and the UI will say so.
    console.log(`  [${index}/${total}] ${slug}: premium-only, not stored`);
    return "skipped";
  }

  const statementMd = detail.content ? htmlToMarkdown(detail.content) : "";
  if (!statementMd) throw new Error(`${slug}: content came back empty but the problem is free`);

  // Parsed here, not at grading time, so a shape change fails the ingest loudly with the slug
  // in the message rather than silently seeding an empty database during a solve.
  if (!detail.exampleTestcases) throw new Error(`${slug}: no exampleTestcases, nothing to seed`);
  const cases = parseSqlCases(detail.exampleTestcases);

  const meta = JSON.parse(detail.metaData ?? "{}") as { mysql?: string[] };
  if (!meta.mysql?.length) throw new Error(`${slug}: metaData has no mysql DDL`);

  const snippets: Record<string, string> = {};
  for (const s of detail.codeSnippets ?? []) snippets[s.langSlug] = s.code;

  db.run(
    `UPDATE problems SET statement_md = ?, statement_source = 'leetcode', hints = ?,
                         snippets = ?, meta_json = ?, examples = ?, fetched_at = ?
     WHERE qid = ?`,
    [
      statementMd,
      "[]",
      JSON.stringify(snippets),
      detail.metaData ?? "{}",
      detail.exampleTestcases,
      new Date().toISOString(),
      row.qid,
    ],
  );

  console.log(
    `  [${index}/${total}] ${slug}: ${cases.length} case(s), ${meta.mysql.length} table(s)`,
  );
  return "stored";
}

export async function ingestSql50(): Promise<void> {
  migrate();

  const slugs = sql50Slugs();
  if (slugs.length === 0) throw new Error("no problems in the 'sql50' list; run `bun run ingest` first");

  console.log(`[sql] fetching ${slugs.length} problems`);
  let stored = 0;

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i]!;
    if ((await ingestOne(slug, i + 1, slugs.length)) === "stored") stored++;

    // Polite, and matched to the catalog ingest's own delay. One fetch per problem ever, so
    // the whole run costs ~20 s and there is no reason to hurry it.
    if (i < slugs.length - 1) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, POLITE_DELAY_MS);
      await promise;
    }
  }

  const done = db
    .query<{ n: number }, []>(
      `SELECT COUNT(*) AS n FROM lists l JOIN problems p ON p.qid = l.qid
       WHERE l.name = 'sql50' AND p.fetched_at IS NOT NULL`,
    )
    .get()?.n ?? 0;

  console.log(`[sql] ${stored} fetched this run, ${done}/${slugs.length} stored`);
}

if (import.meta.main) {
  await ingestSql50();
}
