import { runSuiteAnyLanguage } from "./src/server/grading.ts";
// 2.5: distinct int64 answers must not compare equal through the float tolerance. Verified through
// the public path, since deepEqual is private.
const meta = { name: "f", params: [{ name: "n", type: "integer" }], return: { type: "integer" } };
const io = JSON.stringify([{ input: "n = 1", output: "13750991318793417920" }]);
const code = `class Solution:
    def f(self, n):
        return 13750991318793417920
`;
const r = await runSuiteAnyLanguage({ slug: "some-int64-problem", code, fnName: "f", ioJson: io, meta, language: "python3" });
console.log(JSON.stringify({ accepted: r.accepted, passed: r.passed, total: r.total, got: r.cases[0]?.got }, null, 2));
