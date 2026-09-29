import { runInLanguage } from "./src/server/runner.ts";
// 2.8: a malformed case line must appear in byIndex with a transport error, and the reported
// total must equal the number of cases SENT.
const meta = { name: "f", params: [{ name: "n", type: "integer" }], return: { type: "integer" } };
const code = `class Solution { public int f(int n) { return n; } }`;
const r = await runInLanguage({ language: "java", code, fnName: "f", cases: [{ args: [1], expected: 1 }, { args: [2], expected: 2 }], meta });
console.log(JSON.stringify({ total: r.total, sent: 2, cases: r.cases.map((c) => ({ i: c.index, pass: c.pass, error: c.error })) }, null, 2));
