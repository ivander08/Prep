/**
 * Executor acceptance fixtures — the regression tests from BUILD-SPEC §5.4.
 *
 * The load-bearing case is `correct_bruteforce`: correct but non-optimal. Published work
 * shows LLM judges misreject exactly this class (correct-code rejection rates fall from
 * 52.4% to 11.0% as prompts get more elaborate). If this suite ever starts failing that
 * case, something has replaced execution with judgement — which is the whole point.
 *
 * Run: bun test
 */

import { describe, expect, test } from "bun:test";
import { buildTestCases, runPython } from "./executor.ts";

const STATEMENT = `
Given an array of integers nums and an integer target, return indices of the two numbers
such that they add up to target.

Example 1:
**Input:** nums = [2,7,11,15], target = 9
**Output:** [0,1]

Example 2:
**Input:** nums = [3,2,4], target = 6
**Output:** [1,2]

Example 3:
**Input:** nums = [3,3], target = 6
**Output:** [0,1]
`;

const META = JSON.stringify({
  name: "twoSum",
  params: [
    { name: "nums", type: "integer[]" },
    { name: "target", type: "integer" },
  ],
  return: { type: "integer[]" },
});

const EXAMPLES = "[2,7,11,15]\n9\n[3,2,4]\n6\n[3,3]\n6";

function twoSumProblem() {
  return buildTestCases({
    statementMd: STATEMENT,
    exampleTestcases: EXAMPLES,
    metaData: META,
  });
}

describe("buildTestCases", () => {
  test("parses 3 cases with expected outputs, despite markdown bold markers", () => {
    const { cases, parseWarning } = twoSumProblem();
    expect(parseWarning).toBeUndefined();
    expect(cases).toHaveLength(3);
    expect(cases[0]?.args).toEqual([[2, 7, 11, 15], 9]);
    expect(cases[0]?.expected).toEqual([0, 1]);
    expect(cases[2]?.expected).toEqual([0, 1]);
  });

  test("refuses to grade when inputs and outputs disagree in count", () => {
    const { cases, parseWarning } = buildTestCases({
      statementMd: STATEMENT.replace(/\*\*Output:\*\* \[\d,\d\]/g, ""),
      exampleTestcases: EXAMPLES,
      metaData: META,
    });
    expect(cases).toHaveLength(0);
    // Names the cause rather than the symptom, and reports the counts for diagnosis.
    expect(parseWarning).toMatch(/not in the standard "Input:\/Output:" layout/);
    expect(parseWarning).toMatch(/3 input groups, 0 output lines/);
  });

  test("marks order-insensitive problems", () => {
    const { cases } = buildTestCases({
      statementMd: `${STATEMENT}\nYou can return the answer in any order.`,
      exampleTestcases: EXAMPLES,
      metaData: META,
    });
    expect(cases[0]?.orderless).toBe(true);
  });
});

const run = (code: string) => runPython({ code, fnName: "twoSum", cases: twoSumProblem().cases });

describe("runPython verdicts", () => {
  test("accepts the canonical hash-map solution", async () => {
    const r = await run(`
class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for i, n in enumerate(nums):
            if target - n in seen:
                return [seen[target - n], i]
            seen[n] = i
`);
    expect(r.accepted).toBe(true);
    expect(r.passed).toBe(3);
  });

  // The case that justifies the whole executor design.
  test("accepts a CORRECT BRUTE FORCE (the class LLM judges misreject)", async () => {
    const r = await run(`
class Solution:
    def twoSum(self, nums, target):
        for i in range(len(nums)):
            for j in range(i + 1, len(nums)):
                if nums[i] + nums[j] == target:
                    return [i, j]
`);
    expect(r.accepted).toBe(true);
    expect(r.passed).toBe(3);
  });

  test("rejects a solution returning values instead of indices", async () => {
    const r = await run(`
class Solution:
    def twoSum(self, nums, target):
        for i in range(len(nums)):
            for j in range(i + 1, len(nums)):
                if nums[i] + nums[j] == target:
                    return [nums[i], nums[j]]
`);
    expect(r.accepted).toBe(false);
    expect(r.passed).toBe(0);
  });

  test("reports a runtime error rather than crashing the harness", async () => {
    const r = await run(`
class Solution:
    def twoSum(self, nums, target):
        for i in range(len(nums) + 5):
            if nums[i] == target:
                return [i, i]
`);
    expect(r.accepted).toBe(false);
    expect(r.cases[0]?.error).toMatch(/IndexError/);
  });

  test("reports a missing method instead of throwing", async () => {
    const r = await run(`
class Solution:
    def notTwoSum(self, nums, target):
        return []
`);
    expect(r.accepted).toBe(false);
    expect(r.stderr).toMatch(/has no method twoSum/);
  });

  test("does not hang on an infinite loop", async () => {
    const r = await runPython({
      code: `
class Solution:
    def twoSum(self, nums, target):
        while True:
            pass
`,
      fnName: "twoSum",
      cases: twoSumProblem().cases,
      timeoutMs: 2000,
    });
    expect(r.accepted).toBe(false);
    expect(r.durationMs).toBeLessThan(8000);
  }, 15_000);
});

describe("order-insensitive grading", () => {
  test("accepts a reversed pair when the problem says 'any order'", async () => {
    const problem = buildTestCases({
      statementMd: `${STATEMENT}\nYou can return the answer in any order.`,
      exampleTestcases: EXAMPLES,
      metaData: META,
    });
    const r = await runPython({
      code: `
class Solution:
    def twoSum(self, nums, target):
        for i in range(len(nums)):
            for j in range(i + 1, len(nums)):
                if nums[i] + nums[j] == target:
                    return [j, i]
`,
      fnName: "twoSum",
      cases: problem.cases,
    });
    expect(r.accepted).toBe(true);
  });
});
