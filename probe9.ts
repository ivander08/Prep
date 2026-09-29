import { checkStatement, gradeSql, normalizeDdl } from "./src/server/sql/run.ts";
import { prepareSuite } from "./src/server/grading.ts";
import { Database } from "bun:sqlite";

console.log("=== 3.3 checkStatement ===");
for (const [q, want] of [
  ["SELECT * FROM T WHERE name = 'a;b'", "ACCEPT"],
  ["SELECT 1;", "ACCEPT"],
  ["SELECT 1; SELECT 2", "REJECT"],
  ["SELECT * FROM T WHERE name = 'a;b'; SELECT 2", "REJECT"],
  ["SELECT * FROM T WHERE name = 'it''s; fine'", "ACCEPT"],
] as const) {
  const r = checkStatement(q, false);
  console.log((r === null ? "ACCEPT" : "REJECT") === want ? "ok  " : "FAIL", JSON.stringify(q), "->", r ?? "ACCEPT");
}

console.log("\n=== 3.1 derived arity ===");
const db = new Database("data/prep.db", { readonly: true });
for (const slug of ["valid-parentheses", "palindrome-number", "two-sum", "valid-anagram", "sort-colors"]) {
  const io = db.query<{ io_cases: string }, [string]>("SELECT io_cases FROM full_tests WHERE slug = ?").get(slug)!.io_cases;
  const m = db.query<{ meta_json: string | null }, [string]>("SELECT meta_json FROM problems WHERE slug = ?").get(slug);
  const meta = m?.meta_json ? JSON.parse(m.meta_json) : null;
  const withMeta = prepareSuite(slug, io, meta);
  const without = prepareSuite(slug, io, null);
  console.log(slug, "meta:", withMeta.cases.length, "no-meta:", without.cases.length, withMeta.ungradeable ? `UNGRADEABLE(${withMeta.ungradeable.slice(0, 40)})` : "");
}

console.log("\n=== 3.4 row cap after sort ===");
const g = gradeSql({
  slug: "probe",
  metaJson: JSON.stringify({ mysql: ["CREATE TABLE t (x INT)"] }),
  examples: Array.from({ length: 250 }, (_, i) => String(i)).join("\n"),
  caseIndex: 0,
  userQuery: "SELECT x FROM t ORDER BY x DESC",
  referenceQuery: "SELECT x FROM t ORDER BY x ASC",
});
console.log("asc-vs-desc 250 rows: passed =", g.passed, "| userRows =", g.userRows.length, "| expectedRows =", g.expectedRows.length);

console.log("\n=== 3.5 normalized schema ===");
console.log(normalizeDdl("CREATE TABLE t (low_fats ENUM('Y', 'N'))"));
