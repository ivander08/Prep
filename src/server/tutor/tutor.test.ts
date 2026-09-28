/**
 * Tutor acceptance fixtures — BUILD-SPEC §8 Phase 2.
 *
 * These cover the two deterministic components: the policy core and the code-reveal
 * detector. The LLM call itself is not unit-tested here — it is verified live against the
 * gateway, because mocking it would test the mock rather than the contract.
 *
 * The detector tests are the load-bearing ones. A detector that under-triggers hands over
 * the answer and destroys the exercise; one that over-triggers is merely annoying. The
 * asymmetry is deliberate and these tests pin it.
 */

import { describe, expect, test } from "bun:test";
import { hintCeiling, ceilingReason, HINT_RULES } from "./policy.ts";
import { detectViolations, findRealSyntax, type Turn } from "./detector.ts";
import { parseFocus } from "./index.ts";

const turn = (over: Partial<Turn> = {}): Turn => ({
  hint_level: 0,
  message: "What have you tried so far?",
  contains_solution: false,
  contains_real_code: false,
  next_question: "What is your first idea?",
  ...over,
});

describe("hintCeiling — deterministic, state-only", () => {
  test("no attempts gives the lowest level", () => {
    expect(hintCeiling({ attempts: 0, minutes: 0, solutionUnlocked: false })).toBe(0);
  });

  test("one attempt allows the technique family", () => {
    expect(hintCeiling({ attempts: 1, minutes: 5, solutionUnlocked: false })).toBe(1);
  });

  test("two to three attempts allow the sticking point", () => {
    expect(hintCeiling({ attempts: 2, minutes: 5, solutionUnlocked: false })).toBe(2);
    expect(hintCeiling({ attempts: 3, minutes: 5, solutionUnlocked: false })).toBe(2);
  });

  test("time raises the ceiling once attempts are exhausted", () => {
    expect(hintCeiling({ attempts: 4, minutes: 5, solutionUnlocked: false })).toBe(3);
    expect(hintCeiling({ attempts: 4, minutes: 15, solutionUnlocked: false })).toBe(4);
    expect(hintCeiling({ attempts: 4, minutes: 30, solutionUnlocked: false })).toBe(5);
  });

  test("unlocking bypasses everything", () => {
    expect(hintCeiling({ attempts: 0, minutes: 0, solutionUnlocked: true })).toBe(6);
  });

  test("the ceiling never decreases as attempts accumulate", () => {
    let prev = -1;
    for (let a = 0; a <= 6; a++) {
      const c = hintCeiling({ attempts: a, minutes: 30, solutionUnlocked: false });
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  test("every level has a rule and the reason is non-empty", () => {
    for (let level = 0; level <= 6; level++) {
      expect(HINT_RULES[level]).toBeTruthy();
    }
    expect(ceilingReason({ attempts: 0, minutes: 0, solutionUnlocked: false })).toBeTruthy();
  });
});

describe("findRealSyntax — distinguishes code from pseudocode", () => {
  test("flags Python definitions", () => {
    expect(findRealSyntax("def twoSum(self, nums, target):")).toBeTruthy();
  });

  test("flags C-style loops", () => {
    expect(findRealSyntax("for (let i = 0; i < n; i++) {")).toBeTruthy();
  });

  test("does NOT flag plain pseudocode", () => {
    expect(findRealSyntax("For each element, check whether its complement was seen.")).toBeNull();
    expect(findRealSyntax("loop over the array, keep a running total")).toBeNull();
  });

  test("does not flag a bare 'for' or 'return' in prose", () => {
    expect(findRealSyntax("Think about what you return at the end.")).toBeNull();
  });
});

describe("detectViolations — the asymmetry that matters", () => {
  test("a clean low-level turn passes", () => {
    expect(detectViolations(turn(), 0)).toHaveLength(0);
  });

  test("self-reported over-ceiling level is caught", () => {
    const v = detectViolations(turn({ hint_level: 4 }), 1);
    expect(v.some((x) => x.kind === "self-report")).toBe(true);
  });

  test("a leaked solution is caught even when self-report is FALSE", () => {
    // The model under-reporting its own leak is exactly the case the text analysis exists for.
    const v = detectViolations(
      turn({
        hint_level: 1,
        contains_solution: false,
        message: "```python\ndef twoSum(self, nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n```",
      }),
      1,
    );
    expect(v.some((x) => x.kind === "full-solution")).toBe(true);
  });

  test("real syntax is caught below H4", () => {
    const v = detectViolations(turn({ message: "Try `def solve():` with a dict." }), 2);
    expect(v.some((x) => x.kind === "real-code")).toBe(true);
  });

  test("pseudocode is ALLOWED at H4", () => {
    const v = detectViolations(
      turn({ hint_level: 4, message: "for each n: if target - n seen, return; else store n" }),
      4,
    );
    expect(v).toHaveLength(0);
  });

  test("a worked example on different input passes at H5", () => {
    const v = detectViolations(
      turn({
        hint_level: 5,
        message: "For nums = [4, 9, 2, 7] and target = 9: start at 4, ask what pairs with it, then move on.",
      }),
      5,
    );
    expect(v).toHaveLength(0);
  });

  test("nothing is checked at H6", () => {
    const v = detectViolations(
      turn({
        hint_level: 6,
        contains_solution: true,
        message: "```python\ndef twoSum(self, nums, target):\n    return []\n```",
      }),
      6,
    );
    expect(v).toHaveLength(0);
  });

  test("a long code fence is treated as a solution even without control flow", () => {
    const fence = "```\n" + Array.from({ length: 8 }, (_, i) => `line ${i}`).join("\n") + "\n```";
    const v = detectViolations(turn({ message: fence }), 2);
    expect(v.some((x) => x.kind === "full-solution")).toBe(true);
  });
});

describe("focus — the field the detector must never see", () => {
  // Not every line a tutor would point at trips the syntax patterns — `for i in range(n):`
  // and `seen[x] = i` are both clean. The trap is the subset that does: a quoted `def`,
  // a C-style `for(`, or a runtime call. Those are exactly the lines a hint about "your
  // loop bound" or "your function signature" refers to, so the overlap is real, not
  // hypothetical.
  const TRAPPING_QUOTES = [
    "def twoSum(self, nums, target):", // Python function definition
    "for (let i = 0; i < n; i++) {", // C-style for loop
    "print(len(seen))", // language runtime call
  ];

  test("a verbatim quote of the student's own line trips the detector in message", () => {
    for (const quoted of TRAPPING_QUOTES) {
      expect(findRealSyntax(quoted)).toBeTruthy();
      expect(detectViolations(turn({ message: quoted }), 2).some((x) => x.kind === "real-code")).toBe(true);
    }
  });

  test("the same quotes carried in focus are not violations", () => {
    // `detectViolations` takes `Omit<Turn, "focus">` so a well-typed caller cannot pass it;
    // this pins the runtime behaviour for a caller that widens the object anyway.
    const t = turn({ message: "Look at the loop bound you wrote." });
    const withFocus = { ...t, focus: TRAPPING_QUOTES.map((q) => ({ quote: q, why: "look here" })) };
    expect(detectViolations(withFocus, 2)).toHaveLength(0);
  });

  test("parseFocus keeps well-shaped entries", () => {
    expect(parseFocus([{ quote: "x = 1", why: "unused" }])).toEqual([{ quote: "x = 1", why: "unused" }]);
  });

  test("parseFocus drops entries with no quote or no why", () => {
    expect(parseFocus([{ why: "no quote" }, { quote: "q" }, { quote: "q", why: "   " }, null, 7])).toEqual([]);
  });

  test("parseFocus treats a missing field as no focus, not as an error", () => {
    // Absent focus must NOT trigger the validate/repair retry: it is normal for an
    // approach-level hint, and repairing would cost a second model call.
    expect(parseFocus(undefined)).toEqual([]);
    expect(parseFocus("nonsense")).toEqual([]);
  });

  test("parseFocus caps the list at three regions", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ quote: `q${i}`, why: "w" }));
    expect(parseFocus(many)).toHaveLength(3);
  });
});
