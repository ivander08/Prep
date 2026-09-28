/**
 * Structured I/O grading.
 *
 * The dataset's `test` field asserts exact equality. For problems with more than one valid
 * answer that is simply wrong: measured, a CORRECT `group-anagrams` solution that returned
 * its groups in a different order was marked WRONG ANSWER.
 *
 * This module grades differently:
 *   1. parse the stored `input_output` pairs into arguments and expected values
 *   2. run the user's code once, collecting raw return values (the harness compares nothing)
 *   3. decide correctness in TypeScript, applying a semantic verifier where one exists
 *
 * Deciding in TypeScript rather than in a generated assertion matters because the rules
 * become testable. An order-free comparison buried in a substituted Python string cannot be
 * unit-tested; `verifiers.ts` can.
 *
 * Cases whose stored expected value is a Python exception message are DROPPED, not graded.
 * The dataset's own reference solution crashed on those, so treating the message as an
 * expectation would fail every correct submission. They are reported as skipped.
 */

import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { db } from "./db.ts";
import { parseArgs, parseExpected, type IoPair } from "./iocases.ts";
import { verifierFor } from "./verifiers.ts";
import { runInLanguage } from "./runner.ts";
import type { ProblemMeta } from "./executor.ts";

export type IoCaseResult = {
  index: number;
  input: string;
  expected: unknown;
  got: unknown;
  pass: boolean;
  /** True when a semantic verifier decided this, rather than exact equality. */
  semantic: boolean;
  error?: string;
};

export type IoRunResult = {
  cases: IoCaseResult[];
  passed: number;
  total: number;
  skipped: number;
  accepted: boolean;
  durationMs: number;
  stderr?: string;
  semanticCount: number;
};

/** Deep equality that treats arrays as order-free when the problem allows it. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
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
};

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
    return { cases: [], skipped: 0, skipReasons: ["io_cases is not valid JSON"] };
  }

  const arity = meta?.params?.length ?? 0;
  const hasVerifier = verifierFor(slug) !== null;
  const cases: PreparedCase[] = [];
  const skipReasons: string[] = [];
  let skipped = 0;

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!;

    const args = parseArgs(pair.input, arity);
    if (args === null) {
      skipped++;
      if (skipReasons.length < 3) skipReasons.push(`case ${i}: input shape not parseable`);
      continue;
    }

    const expected = parseExpected(pair.output);

    /**
     * A case whose expected value is `null` cannot be graded outside Python, so it is DROPPED
     * rather than compared.
     *
     * `null` is not a value every language can produce. 2,357 cases across 68 problems expect
     * `None`/`null` — they are problems that guarantee a solution exists, so the dataset's
     * reference solution falls off the end. Measured on `two-sum`: a correct JavaScript solution
     * scored 72/80 and a correct C++ solution 71/80, with every single failure an
     * `expected: null` case.
     *
     * Python passes them because falling off the end returns `None`, which serialises to `null`.
     * The other four return an empty array, or `undefined` (which `JSON.stringify` drops
     * entirely, so the harness emits malformed JSON for that case), or they throw. "Implicitly
     * returns nothing" is not expressible in a statically typed signature.
     *
     * Dropping beats inventing an equivalence: treating `[]` as "no solution" would accept an
     * empty array on a problem where it IS the wrong answer, and a false ACCEPT is the one
     * direction that teaches something untrue.
     *
     * A `void` entry point is the exception — there `null` is the genuine, representable answer,
     * so those cases are kept. The skip is reported in the run's `skipped` count rather than
     * hidden.
     */
    const retType = meta?.return?.type;
    if (expected.kind === "ok" && expected.value === null && retType !== "void") {
      skipped++;
      if (skipReasons.length < 3) {
        skipReasons.push(
          `case ${i}: expects null, which only Python can return from a ${retType ?? "non-void"} signature`,
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
      // The POSITION in the filtered payload, not the position in the original suite.
      // The harness enumerates the cases it is given from 0, so any earlier skipped case
      // would otherwise desync every later lookup: a suite whose first case was skipped
      // returned "no result" for every case after it, because the harness reported index 0
      // while the map was keyed by the original index 1.
      index: cases.length,
      input: pair.input,
      args,
      expected: expected.kind === "string" ? expected.value : expected.value,
      semantic: hasVerifier,
    });
  }

  return { cases, skipped, skipReasons };
}

const PY_IO_HARNESS = async (code: string, payloadB64: string, fn: string): Promise<string> => {
  const template = await Bun.file(join(import.meta.dir, "harnesses/io_check.py.txt")).text();
  return template
    .replace("__USER_CODE__", code)
    .replace("__PAYLOAD_B64__", payloadB64)
    .replace("__FN__", fn);
};

/**
 * Run a suite and grade it semantically.
 *
 * Never throws on user error: a syntax error or a crash comes back as a failed result
 * carrying the message, because that message is what the student needs to see.
 */
export async function runSuite(opts: {
  slug: string;
  code: string;
  fnName: string;
  ioJson: string;
  meta: ProblemMeta | null;
  timeoutMs?: number;
}): Promise<IoRunResult> {
  const started = Date.now();
  const prepared = prepareSuite(opts.slug, opts.ioJson, opts.meta);

  if (prepared.cases.length === 0) {
    return {
      cases: [],
      passed: 0,
      total: 0,
      skipped: prepared.skipped,
      accepted: false,
      durationMs: Date.now() - started,
      semanticCount: 0,
      stderr: `no gradeable cases (${prepared.skipReasons.join("; ") || "suite empty"})`,
    };
  }

  const payload = Buffer.from(
    JSON.stringify({ cases: prepared.cases.map((c) => ({ args: c.args })) }),
    "utf8",
  ).toString("base64");

  const program = await PY_IO_HARNESS(opts.code, payload, opts.fnName);
  const file = join(tmpdir(), `prep_io_${crypto.randomUUID()}.py`);
  await writeFile(file, program, "utf8");

  const proc = Bun.spawn(["python", file], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });

  const killer = setTimeout(() => proc.kill(), opts.timeoutMs ?? 20_000);
  let stdout = "";
  let stderr = "";
  try {
    [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
  } finally {
    clearTimeout(killer);
    await rm(file, { force: true });
  }

  const line = stdout.trim().split("\n").filter(Boolean).pop();
  if (!line) {
    return {
      cases: [],
      passed: 0,
      total: prepared.cases.length,
      skipped: prepared.skipped,
      accepted: false,
      durationMs: Date.now() - started,
      semanticCount: 0,
      stderr: stderr.slice(0, 2000) || "no output (process killed or crashed)",
    };
  }

  let parsed: { fatal?: string; results?: Array<{ index: number; got: unknown; error?: string }> };
  try {
    parsed = JSON.parse(line);
  } catch {
    return {
      cases: [],
      passed: 0,
      total: prepared.cases.length,
      skipped: prepared.skipped,
      accepted: false,
      durationMs: Date.now() - started,
      semanticCount: 0,
      stderr: `harness emitted non-JSON: ${line.slice(0, 300)}`,
    };
  }

  if (parsed.fatal) {
    return {
      cases: [],
      passed: 0,
      total: prepared.cases.length,
      skipped: prepared.skipped,
      accepted: false,
      durationMs: Date.now() - started,
      semanticCount: 0,
      stderr: parsed.fatal,
    };
  }

  const byIndex = new Map((parsed.results ?? []).map((r) => [r.index, r]));
  const results: IoCaseResult[] = [];
  const verifier = verifierFor(opts.slug);
  let passed = 0;

  for (const c of prepared.cases) {
    const raw = byIndex.get(c.index);

    if (!raw) {
      results.push({ index: c.index, input: c.input, expected: c.expected, got: null, pass: false, semantic: false, error: "no result returned" });
      continue;
    }

    if (raw.error) {
      results.push({ index: c.index, input: c.input, expected: c.expected, got: null, pass: false, semantic: false, error: raw.error });
      continue;
    }

    // A semantic verifier decides where the answer set is order-free; exact equality
    // otherwise, because strictness is correct for single-answer problems.
    const verdict = verifier
      ? verifier(raw.got, c.expected)
      : { pass: deepEqual(raw.got, c.expected) };

    if (verdict.pass) passed++;
    results.push({
      index: c.index,
      input: c.input,
      expected: c.expected,
      got: raw.got,
      pass: verdict.pass,
      semantic: Boolean(verifier),
      ...("reason" in verdict && verdict.reason ? { error: verdict.reason } : {}),
    });
  }

  const total = prepared.cases.length;
  return {
    cases: results,
    passed,
    total,
    skipped: prepared.skipped,
    accepted: passed === total,
    durationMs: Date.now() - started,
    semanticCount: verifier ? results.length : 0,
    ...(stderr.trim() ? { stderr: stderr.slice(0, 2000) } : {}),
  };
}

/**
 * Whether a language can construct this case's arguments at all.
 *
 * Java and C++ bind to the DECLARED parameter types, and both declare `int` as 32-bit. The
 * dataset contains inputs outside that range on problems whose signature is `int[]` — measured
 * on `two-sum`, one case passes `-3000000000`, which `Integer.parseInt` and `stoi` reject.
 *
 * That is a dataset/signature mismatch, not a wrong answer: the case cannot be RUN, so it must
 * not be counted as a failure. Reporting it as a failure would mark a correct solution wrong,
 * which is the exact false rejection this app exists to avoid. Python, JavaScript and Go have
 * arbitrary-precision or 64-bit integers and run it fine.
 *
 * C++ additionally has no `double` parameter coercion, so a `double` param is unconstructable
 * there; that is caught by the same rule rather than by a separate branch.
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
};

/**
 * Grade any language against the imported suite.
 *
 * THE POINT OF THIS FUNCTION: the suite is language-agnostic and always was. `io_cases` is a
 * JSON array of `{input: "nums = [3,3]", output: "[0,1]"}` pairs, and both the argument
 * parsing and the expected-value parsing happen in TypeScript (`prepareSuite`). The only
 * Python-specific part was the ASSERTS — `runFullTests` runs the dataset's generated
 * `check(candidate)` function, which is Python source.
 *
 * So a JavaScript or Go submission can use the same 80 cases as Python. It needs a different
 * CALLER, not a different suite: run each case through that language's existing harness
 * (`runInLanguage`, the same one the example-fallback path uses), then decide correctness here.
 *
 * Grading here rather than in the harness also removes a whole class of per-language bug. The
 * C++ harness has no `string[]` comparison at all, and its `int[]` comparison sorts both sides
 * — which silently accepts a wrong ORDER on a problem that cares about order. Comparing in one
 * place means one set of rules, and `verifiers.ts` already holds the order-free cases
 * explicitly.
 *
 * `runInLanguage` reports pass/fail per case using its own harness comparison; those verdicts
 * are ignored. The raw `got` values are what matter, and only the harness's `got` rendering
 * needs to be faithful.
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

  /**
   * Drop cases this language cannot construct, BEFORE running. See `caseFits` — a case whose
   * arguments exceed the declared 32-bit type cannot be executed, so counting it as a failure
   * would mark a correct solution wrong.
   *
   * Re-indexed as it is filtered, because the harness enumerates the cases it is HANDED from 0.
   * Keeping the original suite position here would desync every lookup past the first dropped
   * case and report "no result returned" for cases that ran fine.
   */
  const runnable: PreparedCase[] = [];
  for (const c of prepared.cases) {
    if (caseFits(opts.language, c.args, opts.meta)) {
      runnable.push({ ...c, index: runnable.length });
    }
  }
  const unconstructable = prepared.cases.length - runnable.length;

  if (runnable.length === 0) {
    return {
      cases: [],
      passed: 0,
      total: 0,
      skipped: prepared.skipped + unconstructable,
      accepted: false,
      durationMs: Date.now() - started,
      semanticCount: 0,
      stderr:
        prepared.cases.length === 0
          ? `no gradeable cases (${prepared.skipReasons.join("; ") || "suite empty"})`
          : `no cases this language can construct (${unconstructable} exceed its integer range)`,
    };
  }

  const run = await runInLanguage({
    language: opts.language,
    code: opts.code,
    fnName: opts.fnName,
    // `orderless` is deliberately not set: this path decides ordering itself, via the
    // semantic verifier, so the harness must not also be applying its own ordering rules.
    cases: runnable.map((c) => ({ args: c.args, expected: c.expected })),
    meta: opts.meta,
    timeoutMs: opts.timeoutMs,
  });

  // A compile error or a crash is reported as a run with no per-case results. Pass that
  // through as-is rather than reporting "0 of 80 passed", which would blame the algorithm.
  if (run.cases.length === 0) {
    return {
      cases: [],
      passed: 0,
      total: runnable.length,
      skipped: prepared.skipped + unconstructable,
      accepted: false,
      durationMs: Date.now() - started,
      semanticCount: 0,
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
    ...(run.stderr ? { stderr: run.stderr } : {}),
  };
}
