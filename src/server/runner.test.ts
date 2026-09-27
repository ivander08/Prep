/**
 * Multi-language executor fixtures.
 *
 * The binding rule differs per language — Python and Java use `class Solution` with a bound
 * method, JavaScript and Go are bare functions — and getting it wrong fails EVERY
 * submission rather than failing loudly. So each language is exercised against a known-good
 * and a known-bad solution.
 *
 * A language whose runtime is not installed is skipped rather than failed, so the suite
 * still runs on a machine without a full toolchain.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { runInLanguage } from "./runner.ts";
import { detectAvailableLanguages, LANGUAGES } from "./languages.ts";

const CASES = [
  { args: [[2, 7, 11, 15], 9], expected: [0, 1], orderless: true },
  { args: [[3, 2, 4], 6], expected: [1, 2], orderless: true },
  { args: [[3, 3], 6], expected: [0, 1], orderless: true },
];

/**
 * C++ needs the signature: it is statically typed, so the harness is generated from the
 * parameter and return types rather than built generically.
 */
const META = {
  name: "twoSum",
  params: [
    { name: "nums", type: "integer[]" },
    { name: "target", type: "integer" },
  ],
  return: { type: "integer[]" },
};

const SOLUTIONS: Record<string, { good: string; bad: string }> = {
  python3: {
    good: `class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for i, n in enumerate(nums):
            if target - n in seen:
                return [seen[target - n], i]
            seen[n] = i
`,
    bad: `class Solution:
    def twoSum(self, nums, target):
        return [0, 0]
`,
  },
  javascript: {
    good: `var twoSum = function(nums, target) {
    const seen = new Map();
    for (let i = 0; i < nums.length; i++) {
        if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];
        seen.set(nums[i], i);
    }
};`,
    bad: `var twoSum = function(nums, target) { return [0, 0]; };`,
  },
  java: {
    good: `class Solution {
    public int[] twoSum(int[] nums, int target) {
        java.util.Map<Integer,Integer> seen = new java.util.HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            if (seen.containsKey(target - nums[i])) return new int[]{seen.get(target - nums[i]), i};
            seen.put(nums[i], i);
        }
        return new int[]{};
    }
}`,
    bad: `class Solution {
    public int[] twoSum(int[] nums, int target) { return new int[]{0, 0}; }
}`,
  },
  cpp: {
    good: `class Solution {
public:
    std::vector<int> twoSum(std::vector<int>& nums, int target) {
        std::unordered_map<int,int> seen;
        for (int i = 0; i < (int)nums.size(); i++) {
            auto it = seen.find(target - nums[i]);
            if (it != seen.end()) return {it->second, i};
            seen[nums[i]] = i;
        }
        return {};
    }
};`,
    bad: `class Solution {
public:
    std::vector<int> twoSum(std::vector<int>& nums, int target) { return {0, 0}; }
};`,
  },
  go: {
    good: `func twoSum(nums []int, target int) []int {
    seen := map[int]int{}
    for i, n := range nums {
        if j, ok := seen[target-n]; ok { return []int{j, i} }
        seen[n] = i
    }
    return []int{}
}`,
    bad: `func twoSum(nums []int, target int) []int { return []int{0, 0} }`,
  },
};

let available: Record<string, boolean> = {};

beforeAll(async () => {
  available = await detectAvailableLanguages();
  const missing = LANGUAGES.filter((l) => !available[l.id]).map((l) => l.id);
  if (missing.length > 0) console.log(`[runner] runtimes not installed, skipping: ${missing.join(", ")}`);
}, 60_000);

for (const lang of LANGUAGES) {
  describe(`${lang.id} harness`, () => {
    test("accepts a correct solution", async () => {
      if (!available[lang.id]) return;
      const r = await runInLanguage({
        language: lang.id,
        code: SOLUTIONS[lang.id]!.good,
        fnName: "twoSum",
        cases: CASES,
        meta: META,
      });
      expect(r.stderr ?? "").not.toContain("compile failed");
      expect(r.passed).toBe(3);
      expect(r.accepted).toBe(true);
    }, 90_000);

    test("rejects a wrong solution", async () => {
      if (!available[lang.id]) return;
      const r = await runInLanguage({
        language: lang.id,
        code: SOLUTIONS[lang.id]!.bad,
        fnName: "twoSum",
        cases: CASES,
        meta: META,
      });
      expect(r.accepted).toBe(false);
      expect(r.passed).toBe(0);
    }, 90_000);
  });
}

describe("language registry", () => {
  test("every language has a distinct langSlug for seeding the editor", () => {
    const slugs = LANGUAGES.map((l) => l.langSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
