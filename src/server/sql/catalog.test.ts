/**
 * SQL 50 catalogue tests.
 *
 * The test that matters is "every reference query executes and returns the statement's own
 * expected rows". The reference query is the grading oracle: a query that does not run, or that
 * returns the wrong rows, grades a correct answer as wrong, which is worse than not grading at
 * all. Parsing the statement's rendered `Output:` table is what makes this a real check rather
 * than "it did not throw" — it compares against the answer LeetCode itself publishes.
 *
 * The key-set check is the other half: a slug with no reference is a problem whose every
 * submission fails, and an extra key is a reference nothing can reach. Both are silent at
 * runtime, so they are asserted here instead.
 *
 * The stored data is required, not skipped. `bun run ingest:sql` is the documented first step
 * after `bun run ingest`, and a suite that quietly passes with an empty catalog would hide the
 * one failure that makes the whole track unusable.
 */

import { describe, expect, test } from "bun:test";
import { db } from "../db.ts";
import { SQL_SOLUTIONS } from "./catalog.ts";
import { MAX_RESULT_ROWS, gradeSql, isReadOnly, normalizeDdl, parseCases, seedDatabase } from "./run.ts";

const SLUGS = db
  .query<{ slug: string }, []>(
    `SELECT p.slug FROM lists l JOIN problems p ON p.qid = l.qid
     WHERE l.name = 'sql50' ORDER BY l.position`,
  )
  .all()
  .map((r) => r.slug);

const PROBLEMS = db
  .query<
    { slug: string; statement_md: string | null; meta_json: string | null; examples: string | null; fetched_at: string | null },
    []
  >(
    `SELECT p.slug, p.statement_md, p.meta_json, p.examples, p.fetched_at
     FROM lists l JOIN problems p ON p.qid = l.qid WHERE l.name = 'sql50' ORDER BY l.position`,
  )
  .all();

type AsciiTable = { label: string | null; cols: string[]; rows: string[][] };

/**
 * Every `+---+` table in a statement, with the `Input:`/`Output:` label that precedes it.
 *
 * The label is CONSUMED by the table that follows it. Without that, a problem whose explanation
 * renders a second table (`last-person-to-fit-in-the-bus` shows the running weights under
 * `Explanation:`) would report two `output` tables and desync the case-by-case comparison.
 */
function asciiTables(md: string): AsciiTable[] {
  const lines = md.split("\n");
  const out: AsciiTable[] = [];
  let label: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i]!.trim();
    const low = s.toLowerCase();
    if (low.startsWith("output:")) label = "output";
    else if (low.startsWith("input:")) label = "input";

    if (!(s.startsWith("+") && [...s].every((c) => c === "+" || c === "-"))) continue;

    const header = (lines[i + 1] ?? "").trim();
    if (!(header.startsWith("|") && header.endsWith("|"))) continue;

    const cols = header.slice(1, -1).split("|").map((c) => c.trim());
    const rows: string[][] = [];
    let j = i + 3;
    while (j < lines.length) {
      const r = lines[j]!.trim();
      if (!(r.startsWith("|") && r.endsWith("|"))) break;
      rows.push(r.slice(1, -1).split("|").map((c) => c.trim()));
      j++;
    }
    out.push({ label, cols, rows });
    label = null;
    i = j - 1;
  }

  return out;
}

/**
 * Statements whose rendered `Output:` table contradicts their own seed data.
 *
 * `group-sold-products-by-the-date` shows `T-shirt` in the table and seeds the row `T-Shirt`,
 * and SQLite's `GROUP_CONCAT` is case-sensitive, so no query can produce both. The seed is what
 * the driver runs against, so the seed wins. Recorded here rather than special-cased inside the
 * assertion, and asserted to be exactly this set, so a second discrepancy cannot slip in
 * unnoticed.
 */
const OUTPUT_TABLE_CONTRADICTS_SEED: Record<string, string[][]> = {
  "group-sold-products-by-the-date": [
    ["2020-05-30", "3", "Basketball,Headphone,T-Shirt"],
    ["2020-06-01", "2", "Bible,Pencil"],
    ["2020-06-02", "1", "Mask"],
  ],
};

/** An ASCII cell as a comparable string: numbers lose their formatting, `null` becomes NULL. */
function normalizeCell(v: string): string {
  const t = v.trim();
  if (t === "null" || t === "None") return "NULL";
  const n = Number(t);
  return t !== "" && Number.isFinite(n) ? String(n) : t;
}

/** A row multiset as a comparable string. Same rule the grader uses: order does not matter. */
function multiset(rows: string[][]): string {
  return rows.map((r) => JSON.stringify(r)).sort().join(" | ");
}

describe("SQL 50 catalogue", () => {
  test("the list holds 50 problems and every one is fetched", () => {
    expect(SLUGS.length).toBe(50);
    const missing = PROBLEMS.filter((p) => !p.fetched_at).map((p) => p.slug);
    expect(missing).toEqual([]);
  });

  test("the reference key set equals the SQL 50 slug set exactly", () => {
    expect(Object.keys(SQL_SOLUTIONS).sort()).toEqual([...SLUGS].sort());
  });

  test("no reference query is a stub", () => {
    for (const [slug, query] of Object.entries(SQL_SOLUTIONS)) {
      expect({ slug, long: query.trim().length > 20, keyword: /^(select|with|delete|update|insert)\b/i.test(query.trim()) })
        .toEqual({ slug, long: true, keyword: true });
    }
  });

  // The content check. For every problem and every stored case, seed the database and assert
  // the reference query returns exactly the rows the statement's own Output table shows.
  test("every reference query returns the statement's expected rows", () => {
    for (const p of PROBLEMS) {
      const reference = SQL_SOLUTIONS[p.slug];
      if (!reference) continue; // the key-set test above already reports this

      const cases = parseCases(p.examples!, p.slug);
      const expected = asciiTables(p.statement_md ?? "").filter((t) => t.label === "output");
      expect({ slug: p.slug, cases: cases.length, outputs: expected.length }).toEqual({
        slug: p.slug,
        cases: cases.length,
        outputs: cases.length,
      });

      for (let i = 0; i < cases.length; i++) {
        const want = expected[i]!;
        // The one statement whose published table disagrees with its own seed data.
        const wantRows = i === 0 && OUTPUT_TABLE_CONTRADICTS_SEED[p.slug]
          ? OUTPUT_TABLE_CONTRADICTS_SEED[p.slug]!
          : want.rows;

        const d = seedDatabase(p.slug, p.meta_json!, p.examples!, i);
        try {
          const rows = (d.query(reference).values() ?? []) as unknown[][];
          // A mutating reference returns no rows, and the table it left IS the answer — that is
          // what the problem's own driver displays.
          const actual = !isReadOnly(reference)
            ? (d.query("SELECT * FROM Person").values() as unknown[][])
            : rows;
          const actualStr = (actual as unknown[][]).map((row) =>
            row.map((v) => (v === null ? "NULL" : String(v))),
          );

          expect({
            slug: p.slug,
            case: i,
            arity: actualStr.every((r) => r.length === want.cols.length),
            rows: multiset(actualStr),
          }).toEqual({
            slug: p.slug,
            case: i,
            arity: true,
            rows: multiset(wantRows.map((r) => r.map(normalizeCell))),
          });
        } finally {
          d.close();
        }
      }
    }
  });

  test("grading accepts the reference query and rejects a wrong one", () => {
    const p = PROBLEMS.find((x) => x.slug === "recyclable-and-low-fat-products")!;
    const args = { slug: p.slug, metaJson: p.meta_json!, examples: p.examples!, caseIndex: 0 };

    const right = gradeSql({ ...args, userQuery: SQL_SOLUTIONS[p.slug]!, referenceQuery: SQL_SOLUTIONS[p.slug]! });
    expect({ passed: right.passed, error: right.error, rows: right.userRows }).toEqual({
      passed: true,
      error: null,
      rows: [[1], [3]],
    });

    const wrong = gradeSql({ ...args, userQuery: "SELECT product_id FROM Products WHERE low_fats = 'Y'", referenceQuery: SQL_SOLUTIONS[p.slug]! });
    expect(wrong.passed).toBe(false);
    expect(wrong.error).toBeNull();
  });

  test("grading ignores row order but not row content", () => {
    const p = PROBLEMS.find((x) => x.slug === "recyclable-and-low-fat-products")!;
    const args = { slug: p.slug, metaJson: p.meta_json!, examples: p.examples!, caseIndex: 0 };
    const referenceQuery = SQL_SOLUTIONS[p.slug]!;

    const reversed = gradeSql({
      ...args,
      userQuery: "SELECT product_id FROM Products WHERE low_fats = 'Y' AND recyclable = 'Y' ORDER BY product_id DESC",
      referenceQuery,
    });
    expect(reversed.passed).toBe(true);
  });

  test("a mutating submission is graded on the state it leaves", () => {
    const p = PROBLEMS.find((x) => x.slug === "delete-duplicate-emails")!;
    const args = { slug: p.slug, metaJson: p.meta_json!, examples: p.examples!, caseIndex: 0 };
    const referenceQuery = SQL_SOLUTIONS[p.slug]!;

    const right = gradeSql({ ...args, userQuery: referenceQuery, referenceQuery });
    expect({ passed: right.passed, mutating: right.mutating, error: right.error }).toEqual({
      passed: true,
      mutating: true,
      error: null,
    });

    // A no-op leaves every duplicate in place, so it is wrong even though it does not error.
    const noop = gradeSql({ ...args, userQuery: "SELECT * FROM Person", referenceQuery });
    expect(noop.passed).toBe(false);
  });

  test("a query that is not one statement is refused with a readable message", () => {
    const p = PROBLEMS.find((x) => x.slug === "recyclable-and-low-fat-products")!;
    const args = { slug: p.slug, metaJson: p.meta_json!, examples: p.examples!, caseIndex: 0 };
    const referenceQuery = SQL_SOLUTIONS[p.slug]!;

    const two = gradeSql({ ...args, userQuery: "SELECT 1; SELECT 2", referenceQuery });
    expect(two.passed).toBe(false);
    expect(two.error).toContain("single statement");

    const notSelect = gradeSql({ ...args, userQuery: "DROP TABLE Products", referenceQuery });
    expect(notSelect.passed).toBe(false);
    expect(notSelect.error).toContain("single SELECT");
  });

  test("the result cap is applied", () => {
    const p = PROBLEMS.find((x) => x.slug === "recyclable-and-low-fat-products")!;
    const args = { slug: p.slug, metaJson: p.meta_json!, examples: p.examples!, caseIndex: 0 };
    const referenceQuery = SQL_SOLUTIONS[p.slug]!;
    const capped = gradeSql({ ...args, userQuery: "SELECT * FROM Products", referenceQuery, limit: 2 });
    expect(capped.userRows.length).toBeLessThanOrEqual(MAX_RESULT_ROWS);
  });

  test("the MySQL DDL normalizer covers every construct in the stored schemas", () => {
    // Not a table of inputs and expected strings: the assertion is that after normalization no
    // stored DDL still contains a construct SQLite rejects. That is the property that matters,
    // and it is checked against the real data rather than against a hand-picked sample.
    const forbidden = /\b(enum\s*\(|auto_increment|unsigned|`|int\s*\(\s*\d+\s*\)|varchar\s*\(\s*\d+\s*\))/i;
    for (const p of PROBLEMS) {
      const meta = JSON.parse(p.meta_json ?? "{}") as { mysql?: string[] };
      for (const ddl of meta.mysql ?? []) {
        expect({ slug: p.slug, remaining: forbidden.test(normalizeDdl(ddl)) }).toEqual({
          slug: p.slug,
          remaining: false,
        });
      }
    }
  });

  test("a two-case problem parses both cases", () => {
    // The newline-delimited parse is the one shape that fails silently: a single JSON.parse
    // throws on these three, and a parser that dropped the second line would seed the wrong
    // database for a problem whose second case is the interesting one.
    const twoCase = PROBLEMS.filter((p) => (p.examples ?? "").includes("\n"));
    expect(twoCase.map((p) => p.slug).sort()).toEqual([
      "biggest-single-number",
      "second-highest-salary",
      "the-number-of-employees-which-report-to-each-employee",
    ]);

    for (const p of twoCase) {
      expect(parseCases(p.examples!, p.slug).length).toBe(2);
    }
  });
});
