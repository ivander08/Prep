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
    if (expected.kind === "poisoned") {
      // The dataset's own reference solution failed here, so there is no valid expectation.
      skipped++;
      if (skipReasons.length < 3) skipReasons.push(`case ${i}: ${expected.message.slice(0, 60)}`);
      continue;
    }

    cases.push({
      index: i,
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

/** Whether a problem has a gradeable structured suite. */
export function hasStructuredSuite(slug: string): boolean {
  const row = db
    .query<{ n: number }, [string]>(
      "SELECT COUNT(*) AS n FROM full_tests WHERE slug = ? AND io_cases IS NOT NULL",
    )
    .get(slug);
  return (row?.n ?? 0) > 0;
}
