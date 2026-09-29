import { Database } from "bun:sqlite";
import { SQL_SOLUTIONS } from "./src/server/sql/catalog.ts";
import { gradeSql } from "./src/server/sql/run.ts";
const db = new Database("data/prep.db", { readonly: true });
const rows = db.query<{ slug: string; meta_json: string; examples: string }, []>(
  `SELECT p.slug, p.meta_json, p.examples FROM lists l JOIN problems p ON p.qid = l.qid WHERE l.name='sql50' ORDER BY l.position`,
).all();
const counts: Array<[string, number]> = [];
for (const r of rows) {
  const ref = SQL_SOLUTIONS[r.slug];
  if (!ref) continue;
  try {
    const g = gradeSql({ slug: r.slug, metaJson: r.meta_json, examples: r.examples, caseIndex: 0, userQuery: ref, referenceQuery: ref });
    counts.push([r.slug, g.userRows.length]);
  } catch { /* skip */ }
}
counts.sort((a, b) => b[1] - a[1]);
console.log("top:", counts.slice(0, 6), "| total problems:", counts.length);
