import { runInLanguage } from "./src/server/runner.ts";
const cases = [{ args: [1], expected: 1 }, { args: [2], expected: 2 }];
const code: Record<string, string> = {
  python3: "class Solution:\n    def f(self, n):\n        return n\n",
  javascript: "var f = function(n) { return n; };",
  java: "class Solution { public int f(int n) { return n; } }",
  cpp: "class Solution { public: int f(int n) { return n; } };",
  go: "func f(n int) int { return n }",
};
const meta = { name: "f", params: [{ name: "n", type: "integer" }], return: { type: "integer" } };
for (const lang of ["python3", "javascript", "java", "cpp", "go"]) {
  const t0 = Date.now();
  const r = await runInLanguage({ language: lang, code: code[lang]!, fnName: "f", cases, meta, timeoutMs: 20000 });
  console.log(lang.padEnd(11), String(Date.now() - t0).padStart(6), "ms  cases:", r.cases.length, "passed:", r.passed, r.stderr?.slice(0, 60) ?? "");
}
