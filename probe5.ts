import { runInLanguage } from "./src/server/runner.ts";
// The suite path decides ordering in TypeScript, so the Java harness's own opinion only matters
// on the examples path. Assert the harness compares positionally by asking it directly.
const meta = { name: "runFixedWindow", params: [{ name: "nums", type: "integer[]" }], return: { type: "integer[]" } };
const code = `class Solution {
    public int[] runFixedWindow(int[] nums) { return nums; }
}`;
const cases = [
  { args: [[1, 2, 3]], expected: [1, 2, 3] },
  { args: [[3, 2, 1]], expected: [1, 2, 3] },
];
const r = await runInLanguage({ language: "java", code, fnName: "runFixedWindow", cases, meta });
console.log(JSON.stringify(r.cases.map((c) => ({ pass: c.pass, got: c.got, error: c.error })), null, 2));
