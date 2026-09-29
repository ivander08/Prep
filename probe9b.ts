import { gradeSql } from "./src/server/sql/run.ts";
const example = JSON.stringify({
  headers: { t: ["x"] },
  rows: { t: Array.from({ length: 250 }, (_, i) => [i]) },
});
const base = { slug: "probe", metaJson: JSON.stringify({ mysql: ["CREATE TABLE t (x INT)"] }), examples: example, caseIndex: 0 };
const asc = gradeSql({ ...base, userQuery: "SELECT x FROM t ORDER BY x ASC", referenceQuery: "SELECT x FROM t ORDER BY x ASC" });
const desc = gradeSql({ ...base, userQuery: "SELECT x FROM t ORDER BY x DESC", referenceQuery: "SELECT x FROM t ORDER BY x ASC" });
const wrong = gradeSql({ ...base, userQuery: "SELECT x FROM t ORDER BY x ASC LIMIT 100", referenceQuery: "SELECT x FROM t ORDER BY x ASC" });
for (const [name, r] of [["asc", asc], ["desc", desc], ["truncated", wrong]] as const) {
  console.log(name.padEnd(10), "passed =", String(r.passed).padEnd(6), "userRows =", String(r.userRows.length).padEnd(4), "expectedRows =", r.expectedRows.length);
}
