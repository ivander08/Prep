/**
 * The SQL runner: seed a throwaway SQLite database from a problem's own seed data, run the
 * student's query and the reference query against two independent copies of it, and compare.
 *
 * Four decisions, each measured rather than assumed:
 *
 * 1. **The reference query is the oracle, not the statement's ASCII output table.** Every
 *    LeetCode SQL statement renders its expected result as a `+---+` table under `Output:`,
 *    and parsing that would be a second parser to get wrong. `SQL_SOLUTIONS` holds one
 *    hand-written query per problem; `catalog.test.ts` proves all 50 execute against the
 *    real seed data, so the oracle is verified rather than trusted. One statement's rendered
 *    table is in fact wrong (`group-sold-products-by-the-date` shows `T-shirt` where the seed
 *    row is `T-Shirt`), which is the argument for the oracle being the query rather than the
 *    table.
 *
 * 2. **Two databases, not one.** The student's query and the reference query each get a
 *    fresh in-memory database seeded identically. Sharing one would let a mutating submission
 *    change what the reference then sees, and `delete-duplicate-emails` (whose answer IS a
 *    `DELETE`) would silently grade against an already-emptied table.
 *
 * 3. **Rows compare as a multiset, order-insensitive; a mutation compares as table state.**
 *    Column names and column order are not compared: `SELECT id, name` and `SELECT name, id`
 *    are the same answer to a question that never asked about column order. A statement that
 *    returns no rows (a `DELETE`) is compared by the state it left, because that is what the
 *    problem's driver shows.
 *
 * 4. **MySQL DDL is normalized, not per-problem patched.** `metaData.mysql` is the only dialect
 *    stored, and SQLite rejects `ENUM(...)`, `AUTO_INCREMENT`, `UNSIGNED` and `varchar(n)`
 *    lengths. The transformation is applied uniformly; a problem that needs more belongs in
 *    the normalizer, with the failing slug in the error, not in a special case here.
 */

import { Database } from "bun:sqlite";

/** One parsed `exampleTestcases` case: the table headers and the seed rows. */
export type SqlCase = {
  headers: Record<string, string[]>;
  rows: Record<string, Array<Array<string | number | null>>>;
};

/**
 * Parse the newline-delimited `exampleTestcases` blob.
 *
 * A single-case problem is one JSON object; the three two-case problems are two JSON objects
 * separated by a newline, and `JSON.parse` on the whole string throws `Unable to parse JSON
 * string` for exactly those. The split is unconditional because it handles both shapes.
 */
export function parseCases(raw: string, slug: string): SqlCase[] {
  const lines = raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  if (lines.length === 0) throw new Error(`${slug}: exampleTestcases is empty, nothing to seed`);

  return lines.map((line) => {
    try {
      return JSON.parse(line) as SqlCase;
    } catch (e) {
      throw new Error(`${slug}: exampleTestcases line was not JSON (${String(e)}): ${line.slice(0, 120)}`);
    }
  });
}

/**
 * MySQL DDL → SQLite DDL.
 *
 * `ENUM('Y','N')` becomes `TEXT`: SQLite has no enum type, and the values in the seed data are
 * already the enum's string labels, so nothing is lost. `varchar(n)` becomes `TEXT` because
 * SQLite ignores the length anyway and the parenthesized form is what the parser chokes on
 * least often. Order matters: the enum rewrite must run before backticks are stripped, because
 * `enum\s*\(` is matched against the raw text.
 */
export function normalizeDdl(ddl: string): string {
  return ddl
    .replace(/enum\s*\([^)]*\)/gi, "TEXT")
    .replace(/AUTO_INCREMENT/gi, "")
    .replace(/\)\s*ENGINE\s*=\s*\w+/gi, ")")
    .replace(/UNSIGNED/gi, "")
    .replace(/`/g, "")
    .replace(/int\s*\(\s*\d+\s*\)/gi, "INTEGER")
    .replace(/varchar\s*\(\s*\d+\s*\)/gi, "TEXT");
}

/** A value as an SQLite literal. Numbers and null pass through; everything else is text. */
function toParam(v: string | number | null): string | number | null {
  return v;
}

/**
 * A fresh in-memory database seeded from one problem's DDL and one case's rows.
 *
 * Throws with the slug in the message on unusable input: a problem whose DDL or seed data does
 * not apply must fail loudly, because the alternative is grading against an empty database
 * where every submission passes.
 */
export function seedDatabase(slug: string, metaJson: string, examples: string, caseIndex: number): Database {
  const meta = JSON.parse(metaJson) as { mysql?: string[] };
  const ddl = meta.mysql ?? [];
  if (ddl.length === 0) throw new Error(`${slug}: metaData has no mysql DDL to seed from`);

  const cases = parseCases(examples, slug);
  const chosen = cases[caseIndex];
  if (!chosen) {
    throw new Error(`${slug}: no case ${caseIndex} (the problem has ${cases.length})`);
  }

  const db = new Database(":memory:");

  for (const statement of ddl) {
    const sql = normalizeDdl(statement);
    try {
      db.run(sql);
    } catch (e) {
      throw new Error(`${slug}: DDL failed after normalization (${String(e)}): ${sql}`);
    }
  }

  for (const [table, rows] of Object.entries(chosen.rows)) {
    if (rows.length === 0) continue;

    // The header list is the column order the seed rows are in. Inserting positionally means
    // the DDL's column order is irrelevant, which matters: `the-number-of-employees-which-
    // report-to-each-employee` declares `name` before `reports_to` and seeds in that order,
    // but nothing guarantees the two agree for every problem.
    const columns = chosen.headers[table];
    if (!columns || columns.length === 0) {
      throw new Error(`${slug}: seed rows for "${table}" but no headers entry`);
    }

    // Named columns, not positional. The DDL's column order and the headers' order agree for
    // every problem today, but nothing enforces that, and a mismatch would silently swap two
    // values of the same type — the worst possible failure, because the query still runs.
    const quoted = columns.map((c) => `"${c}"`).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const insert = db.query(`INSERT INTO "${table}" (${quoted}) VALUES (${placeholders})`);

    try {
      db.transaction(() => {
        for (const row of rows) insert.run(...(row.map(toParam) as never[]));
      })();
    } catch (e) {
      throw new Error(`${slug}: seeding "${table}" failed (${String(e)})`);
    }
  }

  return db;
}

/**
 * The result rows a query produced, as JSON-encoded tuples.
 *
 * Uncapped. `MAX_RESULT_ROWS` is a TRANSPORT limit, not a comparison limit: truncating before the
 * multiset sort meant two result sets that are the same multiset of 250 rows truncated to two
 * different 200-row subsets purely because the query returned them in a different order — and the
 * order is not part of the contract. The cap is applied where the rows are handed to the browser.
 */
function rowsOf(db: Database, query: string): unknown[][] {
  const statement = db.query(query);
  // `values()` returns null for a statement that produces no rows, so a submission whose
  // leading keyword is SELECT but which returns nothing (or a non-SELECT the reference's shape
  // permitted) comes back as an empty result rather than a crash.
  return (statement.values() ?? []) as unknown[][];
}

/** A row as a stable string, so two results can be compared as multisets. */
function rowKey(row: unknown[]): string {
  return JSON.stringify(row);
}

/** Cap on the rows returned to the browser. A cartesian-product mistake is otherwise megabytes. */
export const MAX_RESULT_ROWS = 200;

/** `true` when a statement produces rows rather than mutating. */
export function isReadOnly(query: string): boolean {
  return /^\s*(select|with)\b/i.test(
    query.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " "),
  );
}

/**
 * Strip SQL comments and reject anything that is not a single statement of the expected shape.
 *
 * This runs in-process, on the user's own machine, against a throwaway in-memory database, so
 * it is NOT a security boundary: there is nothing here a local user could not do directly with
 * `sqlite3`. It exists so a two-statement paste or a stray trailing semicolon produces "write
 * one statement" instead of `SQLiteError: near ";"`, which reads as a bug in the app.
 *
 * `allowMutation` is driven by the reference query's own shape, not by a slug list. One of the
 * 50 problems (`delete-duplicate-emails`) is answered with a `DELETE` and the driver shows the
 * table afterwards, so a blanket "must start with SELECT" would leave it ungradable.
 */
export function checkStatement(query: string, allowMutation: boolean): string | null {
  const stripped = query
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim();

  if (stripped.length === 0) return "the query is empty";

  if (!allowMutation && !/^(select|with)\b/i.test(stripped)) {
    return "write a single SELECT (or WITH … SELECT) statement";
  }

  if (allowMutation && !/^(select|with|delete|update|insert)\b/i.test(stripped)) {
    return "write a single SELECT, DELETE, UPDATE or INSERT statement";
  }

  // A semicolon with anything but whitespace after it is a second statement — but only outside a
  // string literal. Searching for the first `;` blindly rejected
  // `SELECT * FROM T WHERE name = 'a;b'` with "write a single statement", which is a correct
  // single-statement query refused before any database was seeded. Measured: `'a;b'` REJECT,
  // `SELECT 1;` ACCEPT, `SELECT 1; SELECT 2` REJECT.
  //
  // Doubled quotes (`''`) are an escape inside a literal and must not toggle the state, or
  // `'it''s; fine'` would end the literal early and expose the semicolon.
  let inStr: string | null = null;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]!;
    if (inStr !== null) {
      if (ch === inStr) {
        if (stripped[i + 1] === inStr) i++;
        else inStr = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      inStr = ch;
      continue;
    }
    if (ch === ";") {
      if (stripped.slice(i + 1).trim().length > 0) {
        return "write a single statement: remove the text after the semicolon";
      }
      // A trailing semicolon with only whitespace after it is harmless.
      break;
    }
  }

  return null;
}

export type SqlGrade = {
  passed: boolean;
  userRows: unknown[][];
  expectedRows: unknown[][];
  /** The student's own SQLite error, or null. A reference-query failure throws instead. */
  error: string | null;
  /** True when the answer is a mutation, so the UI labels the table state rather than a result. */
  mutating: boolean;
};

/** Every table in the database, so a mutation can be compared by its effect rather than its output. */
function tableNames(db: Database): string[] {
  return db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
}

/**
 * The whole database as a sorted multiset of `table:row` keys.
 *
 * Used only for a mutating submission: a `DELETE` returns no rows, so the thing to compare is
 * the state it left behind. Sorting makes it order-independent for the same reason the row
 * comparison is: no problem in the 50 specifies a physical row order in the table itself.
 */
function snapshot(db: Database): string[] {
  const out: string[] = [];
  for (const table of tableNames(db)) {
    for (const row of db.query(`SELECT * FROM "${table}"`).values() as unknown[][]) {
      out.push(`${table}:${rowKey(row)}`);
    }
  }
  return out.sort();
}

/** The rows of the one table a mutation changed, for display. */
function changedTable(before: string[], after: string[]): boolean {
  return before.join("\u0000") !== after.join("\u0000");
}

/**
 * Grade one submission against the reference query.
 *
 * The reference query failing is a content bug, not a student error, so it throws: a silent
 * `passed: false` on a broken oracle would be indistinguishable from a wrong answer and would
 * make the whole track untrustworthy.
 */
export function gradeSql(opts: {
  slug: string;
  metaJson: string;
  examples: string;
  caseIndex: number;
  userQuery: string;
  referenceQuery: string;
  limit?: number;
}): SqlGrade {
  const limit = opts.limit ?? MAX_RESULT_ROWS;
  const mutating = !isReadOnly(opts.referenceQuery);

  const refusal = checkStatement(opts.userQuery, mutating);
  if (refusal) {
    return { passed: false, userRows: [], expectedRows: [], error: refusal, mutating };
  }

  const userDb = seedDatabase(opts.slug, opts.metaJson, opts.examples, opts.caseIndex);
  const refDb = seedDatabase(opts.slug, opts.metaJson, opts.examples, opts.caseIndex);

  // --- the reference, run first so a broken oracle fails loudly before the student's query ---
  let expectedRows: unknown[][];
  let expectedState: string[] | null = null;
  try {
    if (mutating) {
      refDb.run(opts.referenceQuery);
      expectedState = snapshot(refDb);
      expectedRows = [];
    } else {
      expectedRows = rowsOf(refDb, opts.referenceQuery);
    }
  } catch (e) {
    throw new Error(`${opts.slug}: the reference query failed (${String(e)})`);
  } finally {
    refDb.close();
  }

  // --- the student's ---
  const seedState = mutating ? snapshot(userDb) : null;

  let userRows: unknown[][];
  try {
    if (mutating) {
      userDb.run(opts.userQuery);
      userRows = [];
    } else {
      userRows = rowsOf(userDb, opts.userQuery);
    }
  } catch (e) {
    userDb.close();
    return {
      passed: false,
      userRows: [],
      expectedRows: expectedRows.slice(0, limit),
      error: String(e),
      mutating,
    };
  }

  if (mutating) {
    const userState = snapshot(userDb);
    // For display: the rows of the table the submission changed. A submission that changed
    // nothing shows the seeded table, which is the honest thing to show.
    const changed = tableNames(userDb).find((t) => {
      const before = seedState!.filter((k) => k.startsWith(`${t}:`));
      const after = userState.filter((k) => k.startsWith(`${t}:`));
      return changedTable(before, after);
    });
    userRows = changed
      ? (userDb.query(`SELECT * FROM "${changed}"`).values() as unknown[][]).slice(0, limit)
      : [];
    userDb.close();

    const a = userState;
    const b = expectedState!;
    const passed = a.length === b.length && a.every((v, i) => v === b[i]);
    return { passed, userRows, expectedRows: [], error: null, mutating };
  }

  userDb.close();

  // Multiset comparison: sort the two lists of row-keys and compare. Order is not part of the
  // contract for any of the 50 problems; column names and column order are not either. Compared
  // UNCAPPED — the cap is a transport limit applied to the copy below, so two orderings of the
  // same 250-row multiset cannot truncate to different subsets and disagree.
  const a = userRows.map(rowKey).sort();
  const b = expectedRows.map(rowKey).sort();
  const passed = a.length === b.length && a.every((v, i) => v === b[i]);

  return {
    passed,
    userRows: userRows.slice(0, limit),
    expectedRows: expectedRows.slice(0, limit),
    error: null,
    mutating,
  };
}
