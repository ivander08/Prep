import { gradeSql } from "./src/server/sql/run.ts";
import { PROBLEMS, SQL_SOLUTIONS } from "./src/server/sql/catalog.ts";
const p = PROBLEMS.find((x) => x.slug === "recyclable-and-low-fat-products")!;
const args = { slug: p.slug, metaJson: p.meta_json!, examples: p.examples!, caseIndex: 0 };
const ref = SQL_SOLUTIONS[p.slug]!;
const full = gradeSql({ ...args, userQuery: ref, referenceQuery: ref });
console.log("reference rows:", full.expectedRows.length);
for (const limit of [2, 3]) {
  const r = gradeSql({ ...args, userQuery: "SELECT * FROM Products", referenceQuery: ref, limit });
  console.log("limit", limit, "-> userRows", r.userRows.length, "expectedRows", r.expectedRows.length);
}
