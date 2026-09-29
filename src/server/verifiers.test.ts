/**
 * Semantic verification and structured I/O tests.
 *
 * These exist because a real bug shipped: the imported suites assert exact equality, so a
 * CORRECT `group-anagrams` solution that returned its groups in a different order was marked
 * WRONG ANSWER. Measured before the fix, passing after.
 *
 * The distinction they defend is narrow: where the answer set is order-free, any valid
 * ordering passes; everywhere else, strict equality stays, because loosening it lets real bugs
 * through. The negative cases matter as much as the positive ones: a verifier that accepts
 * everything would make the false-rejection bug disappear by making the tool useless.
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
    // every correct submission, so they must be dropped, not compared.
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
    // Same multiset of strings, different grouping: must not pass.
    expect(v([["a", "b"], ["c"]], [["a", "b", "c"]]).pass).toBe(false);
  });

  test("two-sum accepts either order of the index pair", () => {
    // The statement says "You can return the answer in any order." Comparing positionally
    // rejected the same correct pair written the other way round: measured, `[i, j]` scored
    // 72/72 and `[j, i]` scored 0/72.
    const v = verifierFor("two-sum")!;
    expect(v([0, 1], [0, 1]).pass).toBe(true);
    expect(v([1, 0], [0, 1]).pass).toBe(true);
  });

  test("two-sum still rejects a different pair", () => {
    // Loosening the order must not loosen the answer: a false ACCEPT teaches something untrue.
    const v = verifierFor("two-sum")!;
    expect(v([0, 2], [0, 1]).pass).toBe(false);
    expect(v([1, 2], [0, 1]).pass).toBe(false);
    expect(v([0], [0, 1]).pass).toBe(false);
    expect(v([0, 1, 2], [0, 1]).pass).toBe(false);
    expect(v("nonsense", [0, 1]).pass).toBe(false);
  });

  test("partition-labels is graded in order, because its answer is a sequence", () => {
    // LeetCode 763 returns partition SIZES in the order the partitions occur:
    // "ababcbacadefegdehijhklij" -> [9,7,8], and [7,8,9] is wrong. Mapping it to the order-free
    // verifier sorted both sides and accepted the wrong order.
    expect(verifierFor("partition-labels")).toBeNull();
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

describe("prepareSuite — case indices must match the harness's own numbering", () => {
  const meta = {
    name: "twoSum",
    params: [
      { name: "nums", type: "integer[]" },
      { name: "target", type: "integer" },
    ],
    return: { type: "integer[]" },
  };

  test("indices are the position in the FILTERED payload, not the original suite", () => {
    // A skipped case shifts everything after it. When `index` kept the original suite position,
    // the harness enumerated its payload from 0 while the lookup map was keyed by the original
    // index, so a suite whose first case was skipped reported "no result returned" for every
    // case after it: measured as a correct Python solution scoring 5/72 on `two-sum`.
    const io = JSON.stringify([
      { input: "nums = [1], target = 1", output: "Error: poisoned" },
      { input: "nums = [2,7], target = 9", output: "[0,1]" },
      { input: "nums = [3,3], target = 6", output: "[0,1]" },
    ]);
    const s = prepareSuite("two-sum", io, meta);
    expect(s.cases).toHaveLength(2);
    expect(s.cases.map((c) => c.index)).toEqual([0, 1]);
  });

  test("null-expected cases are dropped, because only Python can return null", () => {
    // 2,357 cases across 68 problems expect None/null. A correct JavaScript solution scored
    // 72/80 on `two-sum` with every failure being one of these: JS returns `undefined`, Go/Java/
    // C++ return an empty array, and none of those is comparable to null.
    const io = JSON.stringify([
      { input: "nums = [2,7], target = 9", output: "[0,1]" },
      { input: "nums = [1,2], target = 4", output: "None" },
    ]);
    const s = prepareSuite("two-sum", io, meta);
    expect(s.cases).toHaveLength(1);
    expect(s.skipped).toBe(1);
    expect(s.skipReasons[0]).toMatch(/expects null/);
  });

  test("a void entry point is reported ungradeable, not graded", () => {
    // A `void` method is graded on the mutation it leaves in its argument, and the stored suite
    // records only the return value — `sort-colors` stores `output: "None"` for all 128 cases.
    // Grading them compared `None` with `None`, so `def sortColors(self, nums): pass` scored
    // 128/128 accepted. There is no expectation to compare against, so there is nothing to grade.
    const voidMeta = { name: "mutate", params: [{ name: "nums", type: "integer[]" }], return: { type: "void" } };
    const io = JSON.stringify([{ input: "nums = [1]", output: "None" }]);
    const s = prepareSuite("some-void-problem", io, voidMeta);
    expect(s.cases).toHaveLength(0);
    expect(s.ungradeable).toMatch(/void entry point/);
  });

  test("a parameter no harness can construct is reported ungradeable", () => {
    // The suite passes `[4,2,7,1,3,6,9]` where the signature wants a ListNode: Python raises
    // AttributeError, Java and C++ have no coercion, and Go substitutes nil. Every case failed,
    // so a correct solution read "0/N wrong answer".
    const nodeMeta = {
      name: "reverseList",
      params: [{ name: "head", type: "ListNode" }],
      return: { type: "ListNode" },
    };
    const io = JSON.stringify([{ input: "head = [1,2,3]", output: "[3,2,1]" }]);
    const s = prepareSuite("reverse-linked-list", io, nodeMeta);
    expect(s.cases).toHaveLength(0);
    expect(s.ungradeable).toMatch(/ListNode/);
  });

  test("arity is derived from the input when the metadata is absent", () => {
    // `meta_json` is filled lazily on first open, so 2,851 of the 2,869 problems with a suite have
    // none. Taking the arity from `meta.params.length ?? 0` rejected every multi-argument case on
    // those problems: measured, `valid-parentheses` graded 0 of 149 and `two-sum` 0 of 80.
    const io = JSON.stringify([
      { input: "nums = [2,7,11,15], target = 9", output: "[0,1]" },
      { input: "nums = [3,2,4], target = 6", output: "[1,2]" },
    ]);
    const s = prepareSuite("two-sum", io, null);
    expect(s.cases).toHaveLength(2);
    expect(s.cases[0]!.args).toEqual([[2, 7, 11, 15], 9]);
    expect(s.skipped).toBe(0);
  });
});
