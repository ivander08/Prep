import { Database } from "bun:sqlite";
import { gradeSql } from "./src/server/sql/run.ts";
// 3.6: a query that runs cleanly but returns the wrong rows must not schedule a card.
const example = JSON.stringify({ headers: { t: ["x"] }, rows: { t: [[1], [2], [3]] } });
const base = { slug: "probe", metaJson: JSON.stringify({ mysql: ["CREATE TABLE t (x INT)"] }), examples: example, caseIndex: 0 };
const right = gradeSql({ ...base, userQuery: "SELECT x FROM t ORDER BY x", referenceQuery: "SELECT x FROM t ORDER BY x" });
const wrongRows = gradeSql({ ...base, userQuery: "SELECT x FROM t WHERE x > 1 ORDER BY x", referenceQuery: "SELECT x FROM t ORDER BY x" });
const syntax = gradeSql({ ...base, userQuery: "SELECT FROM", referenceQuery: "SELECT x FROM t ORDER BY x" });
for (const [n, r] of [["right", right], ["wrong-rows", wrongRows], ["syntax", syntax]] as const) {
  console.log(n.padEnd(11), "passed =", String(r.passed).padEnd(6), "error =", r.error === null ? "null" : r.error.slice(0, 40));
}
