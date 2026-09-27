/**
 * Executor — the source of truth for correctness.
 *
 * The LLM never decides whether code is correct. It narrates why; this decides.
 * The case for that split is measurable: LLM judges misreject *correct but non-optimal*
 * code (published rejection rates fall from 52.4% to 11.0% as prompts get more
 * elaborate). A correct brute-force Two Sum is exactly that class of submission, and
 * this executor accepts it instantly.
 *
 * TWO GOTCHAS, both found by running it — see the dossier §5.4:
 *   1. `exampleTestcases` lines are JSON-encoded STRINGS ('[2,7,11,15]', '9'), not
 *      values. They must be JSON.parse'd per line and grouped by params.length.
 *   2. LeetCode's Python stub is a `Solution` CLASS METHOD taking `self`, but
 *      `metaData.params` OMITS `self`. A naive harness calls a bare function and fails
 *      EVERY submission with "missing 1 required positional argument".
 *
 * KNOWN LIMITATION, surfaced in the UI rather than hidden: only `exampleTestcases` are
 * public. LeetCode's hidden tests are not in the API, so passing here is not a guarantee
 * of passing LeetCode.
 */

import { fetchProblem, htmlToMarkdown } from "./leetcode.ts";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export type ParamSpec = { name: string; type: string };
export type ProblemMeta = { name: string; params: ParamSpec[]; return?: { type: string } };

export type TestCase = { args: unknown[]; expected: unknown; orderless: boolean };

export type CaseResult = {
  index: number;
  args: unknown[];
  expected: unknown;
  got: unknown;
  pass: boolean;
  error?: string;
};

export type RunResult = {
  cases: CaseResult[];
  passed: number;
  total: number;
  accepted: boolean;
  durationMs: number;
  stderr?: string;
  /** Set when the expected outputs could not be parsed — NOT the same as "wrong". */
  parseWarning?: string;
};

const EMPHASIS = /\*+/g;

/**
 * Pull `Output:` values out of the statement markdown.
 *
 * The captured text carries markdown bold markers: `<strong>Output:</strong> true`
 * becomes `**Output:** true`, so a naive `/Output:\s*(.+)/` captures "** true".
 * Strip emphasis before parsing.
 */
function parseExpectedOutputs(statementMd: string): string[] {
  const out: string[] = [];
  const re = /\*{0,2}Output:?\*{0,2}\s*\n?\s*([^\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(statementMd)) !== null) {
    const raw = (m[1] ?? "").replace(EMPHASIS, "").trim();
    if (raw.length > 0) out.push(raw);
  }
  return out;
}

/** Best-effort parse of a LeetCode output string into a JS value. */
function parseOutputValue(raw: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const s = raw.trim().replace(/^`|`$/g, "").trim();

  if (s === "true") return { ok: true, value: true };
  if (s === "false") return { ok: true, value: false };
  if (s === "null") return { ok: true, value: null };

  // Numbers, arrays, objects, quoted strings are all valid JSON as-is.
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    // Bare identifier / prose (e.g. a tree or list rendered as [1,2,null,3]) — give up.
    return { ok: false, reason: `not JSON: ${JSON.stringify(s.slice(0, 60))}` };
  }
}

export type ParsedProblem = {
  meta: ProblemMeta;
  cases: TestCase[];
  parseWarning?: string;
};

/**
 * Build runnable test cases from a problem's `exampleTestcases` blob and statement.
 * Fetching is the caller's job so this stays pure and testable.
 */
export function buildTestCases(args: {
  statementMd: string;
  exampleTestcases: string | null;
  metaData: string | null;
}): ParsedProblem {
  const meta = JSON.parse(args.metaData ?? "{}") as ProblemMeta;
  const paramCount = meta.params?.length ?? 0;

  if (paramCount === 0) {
    return { meta, cases: [], parseWarning: "problem has no params in metaData" };
  }

  const lines = (args.exampleTestcases ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const groups: unknown[][] = [];
  for (let i = 0; i + paramCount <= lines.length; i += paramCount) {
    const group = lines.slice(i, i + paramCount).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return l; // string params arrive unquoted in some problems
      }
    });
    groups.push(group);
  }

  const outputs = parseExpectedOutputs(args.statementMd);

  // "return the answer in any order" — exact array equality would fail a valid permutation.
  const orderless = /\bin any order\b/i.test(args.statementMd);

  if (outputs.length < groups.length) {
    return {
      meta,
      cases: [],
      parseWarning: `found ${groups.length} input groups but only ${outputs.length} Output lines — cannot grade reliably`,
    };
  }

  const cases: TestCase[] = [];
  const failures: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    const parsed = parseOutputValue(outputs[i] ?? "");
    if (!parsed.ok) {
      failures.push(`case ${i}: ${parsed.reason}`);
      continue;
    }
    cases.push({ args: groups[i] ?? [], expected: parsed.value, orderless });
  }

  if (cases.length === 0) {
    return { meta, cases: [], parseWarning: `no parseable expected outputs (${failures.join("; ")})` };
  }
  if (failures.length > 0) {
    return {
      meta,
      cases,
      parseWarning: `graded ${cases.length} of ${groups.length} cases; skipped — ${failures.join("; ")}`,
    };
  }

  return { meta, cases };
}

// ---------------------------------------------------------------------------
// Python harness
// ---------------------------------------------------------------------------

const PY_HARNESS = String.raw`
import json, sys, base64, time

# Payload arrives base64-encoded as a literal so user code and payload never share a
# stream — concatenating them onto stdin made json.loads() fail on every run.
PAYLOAD = json.loads(base64.b64decode(PAYLOAD_B64).decode("utf-8"))
CASES = PAYLOAD["cases"]
FN = PAYLOAD["fn"]
ORDERLESS = PAYLOAD["orderless"]

def _norm(v, orderless):
    if isinstance(v, list) and orderless:
        try:
            return sorted(v, key=lambda x: json.dumps(x, sort_keys=True))
        except Exception:
            return v
    return v

def _eq(got, exp, orderless):
    return _norm(got, orderless) == _norm(exp, orderless)

_target = getattr(Solution(), FN, None)
if _target is None:
    print(json.dumps({"fatal": "class Solution has no method " + FN}))
    sys.exit(0)

results = []
passed = 0
t0 = time.perf_counter()
for i, case in enumerate(CASES):
    args = case["args"]
    expected = case["expected"]
    orderless = bool(ORDERLESS)
    try:
        got = _target(*args)
        ok = _eq(got, expected, orderless)
        results.append({"index": i, "args": args, "expected": expected,
                        "got": got, "pass": bool(ok)})
        passed += bool(ok)
    except Exception as e:
        results.append({"index": i, "args": args, "expected": expected,
                        "got": None, "pass": False,
                        "error": type(e).__name__ + ": " + str(e)[:200]})
elapsed = (time.perf_counter() - t0) * 1000

print(json.dumps({"cases": results, "passed": passed,
                  "total": len(CASES), "durationMs": elapsed}))
`;

export type RunOptions = {
  code: string;
  fnName: string;
  cases: TestCase[];
  timeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Full test suites (imported from newfacade/LeetCodeDataset)
// ---------------------------------------------------------------------------

export type FullTestRow = {
  slug: string;
  entry_point: string;
  prelude: string;
  test_body: string;
  /** JSON array of {input, output} pairs, when the import captured them. */
  io_cases: string | null;
};

export type FullRunResult = {
  /** 'full' means a real test suite ran; 'examples' means we fell back to public cases. */
  source: "full" | "examples";
  passed: boolean;
  assertions: number;
  failedAssertion: string | null;
  error: string | null;
  stdout: string;
  durationMs: number;
};

/**
 * Run a user's solution against the imported full test suite.
 *
 * The dataset ships a `check(candidate)` function containing many
 * `assert candidate(...) == expected` statements, plus a `prompt` block that carries the
 * imports and a ListNode/TreeNode prelude some problems need. The prelude must be emitted
 * BEFORE user code or those problems fail on an undefined name.
 *
 * `entry_point` is a dotted path (`Solution().shortestDistanceAfterQueries`), so it is
 * evaluated rather than called directly — that is exactly how the dataset's own harness
 * does it, and it binds the same way the executor already calls user code.
 *
 * Assertions are counted by running `check()` and catching AssertionError. There is no
 * per-assertion granularity available from an assert-based suite, so a failure reports the
 * first failing assertion rather than a pass/fail count. That is a real limitation of the
 * format, not an oversight.
 */
export async function runFullTests(opts: {
  code: string;
  suite: FullTestRow;
  timeoutMs?: number;
}): Promise<FullRunResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const started = Date.now();

  const assertionCount = (opts.suite.test_body.match(/^\s*assert\s+candidate\(/gm) ?? []).length;

  const harness = [
    opts.suite.prelude,
    opts.code,
    opts.suite.test_body,
    "",
    "import traceback, json, sys",
    "_entry = " + opts.suite.entry_point,
    "try:",
    "    check(_entry)",
    "    print(json.dumps({'ok': True}))",
    "except AssertionError as e:",
    "    tb = traceback.format_exc().strip().split('\\n')",
    "    line = next((l.strip() for l in reversed(tb) if l.strip().startswith('assert')), 'assertion failed')",
    "    print(json.dumps({'ok': False, 'assertion': line[:400]}))",
    "except Exception as e:",
    "    print(json.dumps({'ok': False, 'error': type(e).__name__ + ': ' + str(e)[:300]}))",
  ].join("\n");

  const file = join(tmpdir(), `prep_full_${crypto.randomUUID()}.py`);
  await writeFile(file, harness, "utf8");

  const proc = Bun.spawn(["python", file], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });

  const killer = setTimeout(() => proc.kill(), timeoutMs);
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

  const durationMs = Date.now() - started;
  const line = stdout.trim().split("\n").filter(Boolean).pop();

  if (!line) {
    return {
      source: "full",
      passed: false,
      assertions: assertionCount,
      failedAssertion: null,
      error: stderr.slice(0, 1200) || "no output (process killed or crashed)",
      stdout: stdout.slice(0, 500),
      durationMs,
    };
  }

  try {
    const parsed = JSON.parse(line) as { ok?: boolean; assertion?: string; error?: string };
    return {
      source: "full",
      passed: Boolean(parsed.ok),
      assertions: assertionCount,
      failedAssertion: parsed.assertion ?? null,
      error: parsed.error ?? null,
      stdout: stdout.slice(0, 500),
      durationMs,
    };
  } catch {
    return {
      source: "full",
      passed: false,
      assertions: assertionCount,
      failedAssertion: null,
      error: `harness emitted non-JSON: ${line.slice(0, 200)}`,
      stdout: stdout.slice(0, 500),
      durationMs,
    };
  }
}

/**
 * Execute Python against the cases in a subprocess. Never throws on user error.
 *
 * The whole program (user code + harness + payload) is assembled into ONE temp file
 * rather than piped through stdin: user code and payload sharing a stream means
 * `json.loads(sys.stdin.read())` sees concatenated text and fails on every run.
 * The payload is base64'd so no user code can collide with it.
 */
export async function runPython(opts: RunOptions): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const started = Date.now();

  const payload = {
    cases: opts.cases.map((c) => ({ args: c.args, expected: c.expected })),
    fn: opts.fnName,
    orderless: opts.cases.some((c) => c.orderless),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

  const program = [
    opts.code,
    `PAYLOAD_B64 = ${JSON.stringify(payloadB64)}`,
    PY_HARNESS,
  ].join("\n");

  const file = join(tmpdir(), `prep_run_${crypto.randomUUID()}.py`);
  await writeFile(file, program, "utf8");

  const proc = Bun.spawn(["python", file], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });

  const killer = setTimeout(() => proc.kill(), timeoutMs);

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

  const durationMs = Date.now() - started;
  const line = stdout.trim().split("\n").filter(Boolean).pop();

  if (!line) {
    return {
      cases: [],
      passed: 0,
      total: opts.cases.length,
      accepted: false,
      durationMs,
      stderr: stderr.slice(0, 2000) || "no output from harness (process killed or crashed)",
    };
  }

  let parsed: { fatal?: string; cases?: CaseResult[]; passed?: number; total?: number };
  try {
    parsed = JSON.parse(line);
  } catch {
    return {
      cases: [],
      passed: 0,
      total: opts.cases.length,
      accepted: false,
      durationMs,
      stderr: `harness emitted non-JSON: ${line.slice(0, 300)}`,
    };
  }

  if (parsed.fatal) {
    return {
      cases: [],
      passed: 0,
      total: opts.cases.length,
      accepted: false,
      durationMs,
      stderr: parsed.fatal,
    };
  }

  const cases = parsed.cases ?? [];
  const passed = parsed.passed ?? 0;
  const total = parsed.total ?? opts.cases.length;
  return {
    cases,
    passed,
    total,
    accepted: passed === total && cases.length > 0,
    durationMs,
    ...(stderr.trim() ? { stderr: stderr.slice(0, 2000) } : {}),
  };
}

/** Fetch a problem and build its runnable cases in one step. */
export async function loadProblem(titleSlug: string): Promise<ParsedProblem> {
  const p = await fetchProblem(titleSlug);
  return buildTestCases({
    statementMd: htmlToMarkdown(p.content ?? ""),
    exampleTestcases: p.exampleTestcases,
    metaData: p.metaData,
  });
}
