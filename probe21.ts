import { runInLanguage } from "./src/server/runner.ts";
const t0 = Date.now();
const r = await runInLanguage({
  language: "go",
  code: "func f(n int) int { return n * 2 }",
  fnName: "f",
  cases: [{ args: [21], expected: 42 }],
  timeoutMs: 30000,
});
console.log(JSON.stringify({ ms: Date.now() - t0, passed: r.passed, total: r.total, cases: r.cases.length, stderr: r.stderr?.slice(0, 200) }));
process.exit(0);
