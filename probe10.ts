import { getSqlProblem, listSqlProblems } from "./src/server/sql/index.ts";
const rows = listSqlProblems();
let enums = 0, checked = 0, errors = 0;
for (const r of rows) {
  try {
    const d = getSqlProblem(r.slug);
    if (!d) continue;
    checked++;
    for (const s of d.schema) if (/ENUM|AUTO_INCREMENT|UNSIGNED/i.test(s)) { enums++; console.log("LEAK", r.slug, s.slice(0, 100)); }
  } catch (e) { errors++; console.log("err", r.slug, String(e).slice(0, 90)); }
}
console.log(`checked ${checked} of ${rows.length}, raw-MySQL leaks ${enums}, fetch errors ${errors}`);
