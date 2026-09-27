/**
 * Semantic verification and structured I/O tests.
 *
 * These exist because a real bug shipped: the imported suites assert exact equality, so a
 * CORRECT `group-anagrams` solution that returned its groups in a different order was
 * marked WRONG ANSWER. Measured before the fix, passing after.
 *
 * The distinction these tests defend is narrow and easy to break:
 *   - where the answer set is genuinely order-free, any valid ordering passes
 *   - everywhere else, strict equality stays, because loosening it lets real bugs through
 *
 * The negative cases matter as much as the positive ones. A verifier that accepts everything
 * would make the false-rejection bug disappear by making the tool useless.
 */

import { describe, expect, test } from "bun:test";
import { verifierFor } from "./verifiers.ts";
import { parseArgs, parseExpected, parseValue } from "./iocases.ts";
import { prepareSuite } from "./grading.ts";

describe("parseArgs", () => {
  test("parses a single array argument", () => {
    expect(parseArgs("nums = [1,2,3]", 1)).toEqual([[1, 2, 3]]);
  });

  test("parses multiple arguments, not splitting on commas inside values", () => {
    expect(parseArgs("nums = [2,7,11,15], target = 9", 2)).toEqual([[2, 7, 11, 15], 9]);
  });

  test("parses nested arrays", () => {
    expect(parseArgs("n = 7, queries = [[0,5],[1,6]]", 2)).toEqual([7, [[0, 5], [1, 6]]]);
  });

  test("parses strings containing commas and brackets", () => {
    expect(parseArgs('strs = ["a,b","c[d]"]', 1)).toEqual([["a,b", "c[d]"]]);
  });

  test("returns null when the arity does not match", () => {
    expect(parseArgs("nums = [1,2]", 2)).toBeNull();
  });

  test("returns null for a value with no assignment", () => {
    expect(parseArgs("[1,2,3]", 1)).toBeNull();
  });

  test("handles a zero-argument case", () => {
    expect(parseArgs("", 0)).toEqual([]);
  });
});

describe("parseExpected", () => {
  test("parses a list", () => {
    expect(parseExpected("[0, 1]")).toEqual({ kind: "ok", value: [0, 1] });
  });

  test("parses Python literals, not just JSON", () => {
    expect(parseExpected("True")).toEqual({ kind: "ok", value: true });
    expect(parseExpected("None")).toEqual({ kind: "ok", value: null });
  });

  test("treats a bare word as a string answer", () => {
    // 174 records in the corpus are bare strings like `aa`; they are real answers, not junk.
    expect(parseExpected("aa")).toEqual({ kind: "string", value: "aa" });
  });

  test("flags a stored exception message as poisoned", () => {
    // 23 records hold the dataset's own crash message. Grading against those would fail
    // every correct submission, so they must be dropped rather than compared.
    const r = parseExpected("Error: Solution.maxAmount() missing 5 required positional arguments");
    expect(r.kind).toBe("poisoned");
  });
});

describe("verifiers — order-free where it is correct, strict everywhere else", () => {
  test("group-anagrams accepts a different group order", () => {
    const v = verifierFor("group-anagrams")!;
    expect(v([["c"], ["a", "b"]], [["a", "b"], ["c"]]).pass).toBe(true);
  });

  test("group-anagrams accepts a different order within a group", () => {
    const v = verifierFor("group-anagrams")!;
    expect(v([["b", "a"]], [["a", "b"]]).pass).toBe(true);
  });

  test("group-anagrams REJECTS genuinely different groups", () => {
    const v = verifierFor("group-anagrams")!;
    expect(v([["a"], ["b"]], [["a", "b"]]).pass).toBe(false);
  });

  test("group-anagrams rejects the right groups split wrongly", () => {
    const v = verifierFor("group-anagrams")!;
    // Same multiset of strings, different grouping — must not pass.
    expect(v([["a", "b"], ["c"]], [["a", "b", "c"]]).pass).toBe(false);
  });

  test("a problem with a single correct answer has no verifier", () => {
    // Two Sum returns indices; the answer is unique, so strict equality is correct.
    expect(verifierFor("two-sum")).toBeNull();
  });

  test("a verifier never accepts a non-list", () => {
    const v = verifierFor("group-anagrams")!;
    expect(v("nonsense", [["a"]]).pass).toBe(false);
    expect(v(null, [["a"]]).pass).toBe(false);
  });
});

describe("prepareSuite", () => {
  const meta = {
    name: "groupAnagrams",
    params: [{ name: "strs", type: "string[]" }],
    return: { type: "string[][]" },
  };

  test("prepares cases and marks them semantic when a verifier exists", () => {
    const io = JSON.stringify([{ input: 'strs = ["a"]', output: "[['a']]" }]);
    const s = prepareSuite("group-anagrams", io, meta);
    expect(s.cases).toHaveLength(1);
    expect(s.cases[0]!.semantic).toBe(true);
    expect(s.skipped).toBe(0);
  });

  test("drops poisoned cases instead of grading against an exception message", () => {
    const io = JSON.stringify([
      { input: 'strs = ["a"]', output: "[['a']]" },
      { input: 'strs = ["b"]', output: "Error: boom" },
    ]);
    const s = prepareSuite("group-anagrams", io, meta);
    expect(s.cases).toHaveLength(1);
    expect(s.skipped).toBe(1);
  });

  test("drops cases whose input cannot be parsed", () => {
    const io = JSON.stringify([{ input: "gibberish without an equals", output: "[1]" }]);
    const s = prepareSuite("two-sum", io, meta);
    expect(s.cases).toHaveLength(0);
    expect(s.skipped).toBe(1);
  });

  test("reports rather than throws on malformed io_cases", () => {
    const s = prepareSuite("group-anagrams", "{not json", meta);
    expect(s.cases).toHaveLength(0);
    expect(s.skipReasons[0]).toMatch(/not valid JSON/);
  });
});

describe("parseValue", () => {
  test("parses JSON scalars and structures", () => {
    expect(parseValue("42")).toBe(42);
    expect(parseValue('"s"')).toBe("s");
    expect(parseValue("[1,2]")).toEqual([1, 2]);
  });

  test("parses single-quoted Python strings", () => {
    expect(parseValue("'abc'")).toBe("abc");
  });
});
