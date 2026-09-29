import { runInLanguage } from "./src/server/runner.ts";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
const before = readdirSync(tmpdir()).filter((n) => n.startsWith("prep_go_"));
const code = `func twoSum(nums []int, target int) []int {
	for {
	}
}`;
const t0 = Date.now();
const r = await runInLanguage({
  language: "go",
  code,
  fnName: "twoSum",
  cases: [{ args: [[1, 2], 3], expected: [0, 1] }],
  timeoutMs: 6000,
});
const after = readdirSync(tmpdir()).filter((n) => n.startsWith("prep_go_"));
console.log(JSON.stringify({ elapsedMs: Date.now() - t0, cases: r.cases.length, stderr: r.stderr?.slice(0, 200), leakedBefore: before, leakedAfter: after }, null, 2));
