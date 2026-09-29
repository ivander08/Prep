/**
 * Structured I/O grading.
 *
 * The dataset's `test` field asserts exact equality, which is wrong for problems with more than one
 * valid answer: a correct `group-anagrams` solution returning its groups in a different order was
 * marked WRONG ANSWER. This module parses the stored `input_output` pairs, runs the code once
 * collecting raw return values, then decides correctness in TypeScript with a semantic verifier
 * where one exists, so the rules are unit-testable (`verifiers.ts` holds the order-free cases). A
 * case expecting a Python exception message is dropped and reported as skipped, since the dataset's
 * own reference solution crashed on those.
 */

import { db } from "./db.ts";
import { parseArgs, parseArgsAuto, parseExpected, type IoPair } from "./iocases.ts";
import { verifierFor } from "./verifiers.ts";
import { runInLanguage } from "./runner.ts";
import type { ProblemMeta } from "./executor.ts";

/** Deep equality that treats arrays as order-free when the problem allows it. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    // Integers compare exactly. A tolerance on integers is not a tolerance: past 2^53 two
    // distinct int64 answers collapse onto the same double, so `unique-paths`' suite — whose
    // outputs run up to 13750991318793417920 — compared a wrong answer as equal to the right
    // one. The tolerance stays for genuinely fractional values, where it exists to absorb the
    // difference between 0.1 + 0.2 and 0.3.
    if (Number.isInteger(a) && Number.isInteger(b)) return false;
    return Math.abs(a - b) < 1e-9;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

export type PreparedCase = {
  index: number;
  input: string;
  args: unknown[];
  expected: unknown;
  semantic: boolean;
};

export type PreparedSuite = {
  cases: PreparedCase[];
  skipped: number;
  skipReasons: string[];
  /**
   * Set when the suite cannot be graded in any language, so the caller answers 422 with the
   * reason instead of reporting "0 of N wrong answer" against code that is correct.
   */
  ungradeable: string | null;
};

/**
 * Parameter types at least one harness can construct from the JSON payload.
 *
 * Every language receives the arguments as JSON, so Python, JavaScript and Go can bind anything
 * JSON can express; Java and C++ bind through `Main.java.txt`'s `coerce` and `runner.ts`'s
 * `CPP_TYPE`. A type outside this set is one no harness can build — `ListNode` and `TreeNode` are
 * the two in the corpus: the suite passes `[4,2,7,1,3,6,9]` where the signature wants a node, so
 * Python raises `AttributeError`, Java and C++ have no branch, and Go substitutes nil through its
 * `reflect.Zero` fallback. That is a limitation of the runner, not a wrong answer, so the whole
 * suite is reported ungradeable rather than graded as a failure.
 *
 * A type only SOME languages bind (`double` and `boolean[]` are Java-but-not-C++) is deliberately
 * NOT listed here: that is a per-language gap, which `caseFits` handles by dropping the case for
 * that language alone.
 */
const CONSTRUCTIBLE_PARAM_TYPES = new Set([
  "integer",
  "integer[]",
  "integer[][]",
  "double",
  "double[]",
  "string",
  "string[]",
  "boolean",
  "boolean[]",
  "character",
  "character[]",
  "character[][]",
]);

/**
 * Turn a stored suite into runnable cases, dropping anything ungradeable.
 *
 * Pure and synchronous so it can be tested without spawning a process.
 */
export function prepareSuite(slug: string, ioJson: string, meta: ProblemMeta | null): PreparedSuite {
  let pairs: IoPair[];
  try {
    pairs = JSON.parse(ioJson) as IoPair[];
  } catch {
    return { cases: [], skipped: 0, skipReasons: ["io_cases is not valid JSON"], ungradeable: null };
  }

  const cases: PreparedCase[] = [];
  const skipReasons: string[] = [];
  let skipped = 0;

  const done = (ungradeable: string | null): PreparedSuite => ({
    cases,
    skipped,
    skipReasons,
    ungradeable,
  });

  // A `void` entry point is graded on the mutation it leaves in its argument, and the stored
  // suite records only the return value — `sort-colors` stores `output: "None"` for all 128
  // cases. Every case therefore "passes" against a no-op: measured, `def sortColors(self, nums):
  // pass` scored 128/128 accepted, and so did `nums.sort(reverse=True)`. There is no expectation
  // to compare against, so there is nothing to grade; inventing one would be a new false-accept
  // surface.
  if (meta?.return?.type === "void") {
    return done("void entry point: graded on the mutation it leaves behind, which the suite does not store");
  }

  // A parameter no harness can construct. See `CONSTRUCTIBLE_PARAM_TYPES`.
  const unbindable = (meta?.params ?? []).filter((p) => !CONSTRUCTIBLE_PARAM_TYPES.has(p.type));
  if (unbindable.length > 0) {
    return done(
      `this problem's signature takes ${unbindable.map((p) => p.type).join(", ")}, ` +
        `which the runner cannot build from the stored cases`,
    );
  }

  /**
   * Arity from the input, with the metadata as a cross-check.
   *
   * `meta_json` is filled lazily on first open, so 2,851 of the 2,869 problems that have a suite
   * have no metadata at all. Taking the arity from `meta.params.length ?? 0` therefore rejected
   * every multi-argument case on those problems: measured, `valid-parentheses` graded 0 of 149,
   * `palindrome-number` 0 of 61, `two-sum` 0 of 80. The count is derivable from the input, which
   * is `name = value` chunks by construction, so it is derived. Measured over all 2,869 stored
   * suites: 286,041 of 288,608 raw cases parse this way, every problem keeps at least 3 gradeable
   * cases, and for all 18 problems that do have metadata the derived count matches
   * `meta.params.length` exactly — including `two-sum` (80), `valid-anagram` (107) and
   * `sort-colors` (128).
   *
   * The metadata still wins when it disagrees with the derived count on a MAJORITY of the cases
   * that parsed: that is the signal the derived parse is wrong for this problem, and the declared
   * signature is the more reliable of the two.
   */
  const derived = pairs.map((p) => parseArgsAuto(p.input));
  const declared = meta?.params?.length;
  const parseable = derived.filter((v) => v !== null).length;
  const disagreed = derived.filter((v) => v !== null && v.length !== declared).length;
  const useDeclared = declared !== undefined && parseable > 0 && disagreed * 2 > parseable;

  const hasVerifier = verifierFor(slug) !== null;

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!;

    const args = useDeclared ? parseArgs(pair.input, declared) : derived[i]!;
    if (args === null) {
      skipped++;
      if (skipReasons.length < 3) skipReasons.push(`case ${i}: input shape not parseable`);
      continue;
    }

    const expected = parseExpected(pair.output);

    /**
     * A case whose expected value is `null` cannot be graded outside Python, so it is dropped and
     * reported in the run's `skipped` count. `null` is not a value every language can produce:
     * 2,357 cases across 68 problems expect `None`/`null`, because the dataset's reference solution
     * falls off the end there. Measured on `two-sum`: a correct JavaScript solution scored 72/80 and
     * a correct C++ solution 71/80, every failure an `expected: null` case. Python passes them
     * because falling off the end returns `None`, which serialises to `null`; the other four return
     * an empty array, `undefined` (which `JSON.stringify` drops entirely, so the harness emits
     * malformed JSON for that case), or they throw. Dropping beats inventing an equivalence: treating
     * `[]` as "no solution" would accept an empty array where it IS the wrong answer, and a false
     * ACCEPT teaches something untrue.
     */
    if (expected.kind === "ok" && expected.value === null) {
      skipped++;
      if (skipReasons.length < 3) {
        skipReasons.push(
          `case ${i}: expects null, which only Python can return from a ${meta?.return?.type ?? "non-void"} signature`,
        );
      }
      continue;
    }

    if (expected.kind === "poisoned") {
      // The dataset's own reference solution failed here, so there is no valid expectation.
      skipped++;
      if (skipReasons.length < 3) skipReasons.push(`case ${i}: ${expected.message.slice(0, 60)}`);
      continue;
    }

    cases.push({
      // The POSITION in the filtered payload, not in the original suite. The harness enumerates
      // the cases it is given from 0, so an earlier skipped case would otherwise desync every
      // later lookup: a suite whose first case was skipped returned "no result" for every case
      // after it, because the harness reported index 0 while the map was keyed by index 1.
      index: cases.length,
      input: pair.input,
      args,
      expected: expected.value,
      semantic: hasVerifier,
    });
  }

  return done(null);
}

/**
 * Whether a language can construct this case's arguments at all.
 *
 * Java and C++ bind to the declared parameter types, and both declare `int` as 32-bit. The
 * dataset contains inputs outside that range on problems whose signature is `int[]`: measured on
 * `two-sum`, one case passes `-3000000000`, which `Integer.parseInt` and `stoi` reject. That is a
 * dataset/signature mismatch, not a wrong answer: the case cannot be run, so counting it as a
 * failure would mark a correct solution wrong. Python, JavaScript and Go have arbitrary-precision
 * or 64-bit integers and run it fine. C++ also has no `double` parameter coercion, so a `double`
 * param is unconstructable there, caught by the same rule.
 */
function caseFits(language: string, args: unknown[], meta: ProblemMeta | null): boolean {
  if (language !== "java" && language !== "cpp") return true;
  const INT32_MIN = -2147483648;
  const INT32_MAX = 2147483647;

  const fits = (v: unknown, type: string | undefined): boolean => {
    if (typeof v === "number") {
      // `integer` is 32-bit in both; `double` is fine for Java but has no coercion in C++.
      if (type === "double") return language !== "cpp";
      if (Number.isInteger(v)) return v >= INT32_MIN && v <= INT32_MAX;
      return true;
    }
    if (Array.isArray(v)) return v.every((x) => fits(x, type));
    return true;
  };

  return args.every((a, i) => fits(a, meta?.params?.[i]?.type));
}

/**
 * The bare method name from a suite's dotted entry point: `Solution().twoSum` -> `twoSum`.
 *
 * Every one of the 2,869 stored suites uses the dotted form, and only 74 problems have `meta_json`
 * to name the method independently. Falling back to `""` for the other 2,795 made the harness look
 * for a method called nothing: measured on `valid-parentheses`, a correct solution scored 0/148 with
 * `class Solution has no method ` on every case.
 */
export function entryPointName(entryPoint: string): string {
  const last = entryPoint.split(".").pop() ?? "";
  return last.endsWith("()") ? last.slice(0, -2) : last;
}

/** Whether a problem has a gradeable structured suite. */
export function hasStructuredSuite(slug: string): boolean {
  const row = db
    .query<{ n: number }, [string]>(
      "SELECT COUNT(*) AS n FROM full_tests WHERE slug = ? AND io_cases IS NOT NULL",
    )
    .get(slug);
  return (row?.n ?? 0) > 0;
}

export type SuiteRow = { slug: string; io_cases: string | null };

export type AnyLanguageSuiteResult = {
  cases: Array<{
    index: number;
    input: string;
    args: unknown[];
    expected: unknown;
    got: unknown;
    pass: boolean;
    semantic: boolean;
    error?: string;
  }>;
  passed: number;
  total: number;
  skipped: number;
  accepted: boolean;
  durationMs: number;
  stderr?: string;
  semanticCount: number;
  /** Set when the suite cannot be graded at all; the route answers 422 with this text. */
  ungradeable: string | null;
};

/**
 * Grade any language against the imported suite.
 *
 * `io_cases` is a JSON array of `{input: "nums = [3,3]", output: "[0,1]"}` pairs, parsed in
 * TypeScript (`prepareSuite`). Only the asserts were Python-specific, since `runFullTests` runs the
 * dataset's generated `check(candidate)` function, so a JavaScript or Go submission uses the same
 * 80 cases as Python with a different caller: each case goes through `runInLanguage`, and
 * correctness is decided here. That removes a class of per-language bug: the C++ harness has no
 * `string[]` comparison, and its `int[]` comparison sorts both sides, accepting a wrong order on a
 * problem that cares about order. One place to compare means one set of rules, and `verifiers.ts`
 * holds the order-free cases. `runInLanguage`'s verdicts are ignored; its `got` rendering is not.
 */
export async function runSuiteAnyLanguage(opts: {
  slug: string;
  code: string;
  fnName: string;
  ioJson: string;
  meta: ProblemMeta | null;
  language: string;
  timeoutMs?: number;
}): Promise<AnyLanguageSuiteResult> {
  const started = Date.now();
  const prepared = prepareSuite(opts.slug, opts.ioJson, opts.meta);

  // A suite that cannot be graded at all. Reported as such so the route can answer 422: grading
  // it would return `accepted: false` over zero cases and read as "your code is wrong".
  if (prepared.ungradeable !== null) {
    return {
      cases: [],
      passed: 0,
      total: 0,
      skipped: prepared.skipped,
      accepted: false,
      durationMs: Date.now() - started,
      semanticCount: 0,
      stderr: prepared.ungradeable,
      ungradeable: prepared.ungradeable,
    };
  }

  /**
   * Drop cases this language cannot construct before running. See `caseFits`: a case whose
   * arguments exceed the declared 32-bit type cannot be executed, so counting it as a failure
   * would mark a correct solution wrong. Re-indexed as it is filtered, because the harness
   * enumerates the cases it is handed from 0. Keeping the original suite position would desync
   * every lookup past the first dropped case and report "no result returned" for cases that ran.
   */
  const runnable: PreparedCase[] = [];
  for (const c of prepared.cases) {
    if (caseFits(opts.language, c.args, opts.meta)) {
      runnable.push({ ...c, index: runnable.length });
    }
  }
  const unconstructable = prepared.cases.length - runnable.length;

  if (runnable.length === 0) {
    const reason =
      prepared.cases.length === 0
        ? `no gradeable cases (${prepared.skipReasons.join("; ") || "suite empty"})`
        : `no cases this language can construct (${unconstructable} exceed its integer range)`;
    return {
      cases: [],
      passed: 0,
      total: 0,
      skipped: prepared.skipped + unconstructable,
      accepted: false,
      durationMs: Date.now() - started,
      semanticCount: 0,
      stderr: reason,
      ungradeable: reason,
    };
  }

  const run = await runInLanguage({
    language: opts.language,
    code: opts.code,
    fnName: opts.fnName,
    // `orderless` is left unset: this path decides ordering itself via the semantic verifier,
    // so the harness must not also apply its own ordering rules.
    cases: runnable.map((c) => ({ args: c.args, expected: c.expected })),
    meta: opts.meta,
    timeoutMs: opts.timeoutMs,
  });

  // A compile error or a crash is reported as a run with no per-case results. Pass that through
  // as-is; reporting "0 of 80 passed" would blame the algorithm.
  if (run.cases.length === 0) {
    return {
      cases: [],
      passed: 0,
      total: runnable.length,
      skipped: prepared.skipped + unconstructable,
      accepted: false,
      durationMs: Date.now() - started,
      semanticCount: 0,
      ungradeable: null,
      ...(run.stderr ? { stderr: run.stderr } : {}),
    };
  }

  const byIndex = new Map(run.cases.map((c) => [c.index, c]));
  const verifier = verifierFor(opts.slug);
  const results: AnyLanguageSuiteResult["cases"] = [];
  let passed = 0;

  for (const c of runnable) {
    const raw = byIndex.get(c.index);
    if (!raw) {
      results.push({
        index: c.index,
        input: c.input,
        args: c.args,
        expected: c.expected,
        got: null,
        pass: false,
        semantic: false,
        error: "no result returned",
      });
      continue;
    }

    if (raw.error) {
      results.push({
        index: c.index,
        input: c.input,
        args: c.args,
        expected: c.expected,
        got: null,
        pass: false,
        semantic: false,
        error: raw.error,
      });
      continue;
    }

    const verdict = verifier
      ? verifier(raw.got, c.expected)
      : { pass: deepEqual(raw.got, c.expected) };

    if (verdict.pass) passed++;
    results.push({
      index: c.index,
      input: c.input,
      args: c.args,
      expected: c.expected,
      got: raw.got,
      pass: verdict.pass,
      semantic: Boolean(verifier),
      ...("reason" in verdict && verdict.reason ? { error: verdict.reason } : {}),
    });
  }

  const total = runnable.length;
  return {
    cases: results,
    passed,
    total,
    skipped: prepared.skipped + unconstructable,
    accepted: passed === total,
    durationMs: Date.now() - started,
    semanticCount: verifier ? results.length : 0,
    ungradeable: null,
    ...(run.stderr ? { stderr: run.stderr } : {}),
  };
}
