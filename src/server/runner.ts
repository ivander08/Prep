/**
 * Multi-language execution.
 *
 * Binding differs per language: python3 (`class Solution:` plus a method taking `self`), java and
 * cpp (`class Solution { public ... }`, `class Solution { public: ... }`) are instantiated and
 * bound; javascript (`var twoSum = function(...)`) and go (`func twoSum(...)`) are bare functions.
 * A wrong binding fails every submission with no clear error, so each language is checked in
 * runner.test.ts against a known-good and a known-bad solution. Java and C++ harnesses are real
 * files under `harnesses/`: string templates had to survive three escaping layers and repeatedly
 * produced uncompilable code, and C++ needs type-directed codegen besides. On Windows a compiled
 * binary must be invoked by absolute path; `./name` returns exit 127.
 */

import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LANGUAGES, languageById, type LanguageId } from "./languages.ts";
import { resourcePath } from "./paths.ts";

export type ParamSpec = { name: string; type: string };
export type ProblemMeta = { name: string; params: ParamSpec[]; return?: { type: string } };

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
};

type Payload = {
  cases: Array<{ args: unknown[]; expected: unknown }>;
  fn: string;
  orderless: boolean;
};

/** JSON literal, valid in every target language (JSON is a subset of all five). */
const payloadLiteral = (p: Payload) => JSON.stringify(p);

// ---------------------------------------------------------------------------
// Inline harnesses (Python, JavaScript, Go)
// ---------------------------------------------------------------------------

/**
 * Python: `class Solution` with a method taking `self`.
 *
 * The payload arrives base64-encoded as a literal so user code and payload never share a
 * stream. Concatenating them onto stdin made `json.loads()` fail on every run.
 */
function pythonProgram(code: string, payload: Payload): string {
  const b64 = Buffer.from(payloadLiteral(payload)).toString("base64");
  return `${code}
PAYLOAD_B64 = "${b64}"
import json, sys, base64
P = json.loads(base64.b64decode(PAYLOAD_B64).decode("utf-8"))
def _norm(v, ol):
    if isinstance(v, list) and ol:
        try: return sorted(v, key=lambda x: json.dumps(x, sort_keys=True))
        except Exception: return v
    return v
_t = getattr(Solution(), P["fn"], None)
if _t is None:
    print(json.dumps({"fatal": "class Solution has no method " + P["fn"]})); sys.exit(0)
out, ok_n = [], 0
for i, c in enumerate(P["cases"]):
    try:
        got = _t(*c["args"])
        ok = _norm(got, P["orderless"]) == _norm(c["expected"], P["orderless"])
        out.append({"index": i, "args": c["args"], "expected": c["expected"], "got": got, "pass": bool(ok)})
        ok_n += bool(ok)
    except Exception as e:
        out.append({"index": i, "args": c["args"], "expected": c["expected"], "got": None, "pass": False,
                    "error": type(e).__name__ + ": " + str(e)[:200]})
print(json.dumps({"cases": out, "passed": ok_n, "total": len(P["cases"])}))`;
}

/** JavaScript: a bare `var fn = function(...)`, no class. */
function javascriptProgram(code: string, payload: Payload): string {
  return `${code}
const P = ${payloadLiteral(payload)};
function norm(v, ol) {
  if (Array.isArray(v) && ol) {
    try { return [...v].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1); } catch { return v; }
  }
  return v;
}
const eq = (a, b, ol) => JSON.stringify(norm(a, ol)) === JSON.stringify(norm(b, ol));
let fn = null;
if (typeof ${payload.fn} === "function") fn = ${payload.fn};
else if (typeof Solution === "function") { const inst = new Solution(); if (typeof inst[${JSON.stringify(payload.fn)}] === "function") fn = inst[${JSON.stringify(payload.fn)}].bind(inst); }
if (!fn) { console.log(JSON.stringify({ fatal: "no callable ${payload.fn}" })); process.exit(0); }
const out = []; let passed = 0;
P.cases.forEach((c, i) => {
  try {
    const got = fn(...c.args);
    const ok = eq(got, c.expected, P.orderless);
    out.push({ index: i, args: c.args, expected: c.expected, got, pass: !!ok });
    if (ok) passed++;
  } catch (e) {
    out.push({ index: i, args: c.args, expected: c.expected, got: null, pass: false, error: (e.name || "Error") + ": " + String(e.message).slice(0, 200) });
  }
});
console.log(JSON.stringify({ cases: out, passed, total: P.cases.length }));`;
}

/**
 * Go: a bare `func fn(...)`, no class.
 *
 * `extraImports` carries the standard library packages a concept needs. A Go file's import
 * declarations must precede every other declaration, and the user's code is spliced in after the
 * harness's own imports, so user code cannot add an import of its own. Without this a Go concept
 * could not use `sort` or `strings`, and "sort this" is not a lesson you can teach with a
 * hand-rolled bubble sort. The imports are emitted as a second import block, which Go allows.
 * Nothing is added by default: Go rejects unused imports, so a blanket list would break every
 * DSA submission.
 */
function goProgram(code: string, payload: Payload, extraImports: string[] = []): string {
  const b64 = Buffer.from(payloadLiteral(payload)).toString("base64");
  const extra = extraImports.length > 0 ? `\nimport (\n${extraImports.map((i) => `  "${i}"`).join("\n")}\n)\n` : "";
  return `package main

import (
  "encoding/base64"
  "encoding/json"
  "fmt"
  "reflect"
)
${extra}
${code}

type P struct {
  Cases []struct {
    Args     []interface{} \`json:"args"\`
    Expected interface{}   \`json:"expected"\`
  } \`json:"cases"\`
}

type res struct {
  Index    int         \`json:"index"\`
  Args     interface{} \`json:"args"\`
  Expected interface{} \`json:"expected"\`
  Got      interface{} \`json:"got"\`
  Pass     bool        \`json:"pass"\`
  Error    string      \`json:"error,omitempty"\`
}

func main() {
  raw, _ := base64.StdEncoding.DecodeString("${b64}")
  var p P
  json.Unmarshal(raw, &p)

  fv := reflect.ValueOf(${payload.fn})
  if !fv.IsValid() {
    fmt.Println("{\\"fatal\\":\\"function ${payload.fn} is not defined\\"}")
    return
  }
  ft := fv.Type()

  out := []res{}
  passed := 0
  for i, c := range p.Cases {
    // JSON unmarshals every array to []interface{}, but reflect.Call needs the concrete
    // parameter type ([]int, not []interface{}). Re-encode each argument and decode it into
    // the parameter's own type — the same trick encoding/json uses internally.
    in := make([]reflect.Value, len(c.Args))
    for j, a := range c.Args {
      rawArg, _ := json.Marshal(a)
      target := reflect.New(ft.In(j))
      if err := json.Unmarshal(rawArg, target.Interface()); err != nil {
        in[j] = reflect.Zero(ft.In(j))
        continue
      }
      in[j] = target.Elem()
    }
    r := res{Index: i, Args: c.Args, Expected: c.Expected}
    func() {
      defer func() {
        if rec := recover(); rec != nil {
          r.Got = nil
          r.Pass = false
          r.Error = fmt.Sprint(rec)
        }
      }()
      v := fv.Call(in)
      if len(v) > 0 {
        r.Got = v[0].Interface()
        gb, _ := json.Marshal(r.Got)
        eb, _ := json.Marshal(c.Expected)
        r.Pass = string(gb) == string(eb)
      }
    }()
    if r.Pass {
      passed++
    }
    out = append(out, r)
  }
  b, _ := json.Marshal(map[string]interface{}{"cases": out, "passed": passed, "total": len(p.Cases)})
  fmt.Println(string(b))
}`;
}

// ---------------------------------------------------------------------------
// Java (file-based harness)
// ---------------------------------------------------------------------------

/**
 * Encode a JS value into the flat format the Java harness reads:
 * arguments joined by U+001F, then U+001E, then the expected value.
 */
function encodeJavaValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(encodeJavaValue).join(",") + "]";
  return JSON.stringify(v);
}

async function javaProgram(code: string, payload: Payload): Promise<string> {
  const cases = payload.cases
    .map((c) => c.args.map(encodeJavaValue).join("\u001f") + "\u001e" + encodeJavaValue(c.expected))
    .join("\n");

  const template = await Bun.file(resourcePath("harnesses/Main.java.txt")).text();
  return template
    .replace("__PAYLOAD_B64__", Buffer.from(cases, "utf8").toString("base64"))
    .replace("__FN__", payload.fn)
    .replace("__USER_CODE__", code);
}

// ---------------------------------------------------------------------------
// C++ (file-based harness + type-directed codegen)
// ---------------------------------------------------------------------------

const CPP_TYPE: Record<string, string> = {
  integer: "int",
  "integer[]": "vector<int>",
  "integer[][]": "vector<vector<int>>",
  double: "double",
  "double[]": "vector<double>",
  string: "string",
  "string[]": "vector<string>",
  boolean: "bool",
  "boolean[]": "vector<bool>",
  // LeetCode's C++ stubs declare these as `char`/`vector<char>`/`vector<vector<char>>`, and the
  // wire format carries each element as a one-character JSON string. Without the entries,
  // `valid-sudoku` (`character[][]`) and `task-scheduler` (`character[]`) hit the "unsupported
  // signature" branch and every case came back an error, so a correct solution read "0/N".
  character: "char",
  "character[]": "vector<char>",
  "character[][]": "vector<vector<char>>",
};

function cppUnpack(meta: ProblemMeta | null): string | null {
  if (!meta?.params?.length) return null;
  const lines: string[] = [];
  for (let i = 0; i < meta.params.length; i++) {
    const t = CPP_TYPE[meta.params[i]!.type];
    if (!t) return null;
    const src = `mini::trim(mini::splitTop(argsBody)[${i}])`;
    if (t === "vector<vector<int>>") lines.push(`  auto a${i} = mini::toIntVec2(${src});`);
    else if (t === "vector<int>") lines.push(`  auto a${i} = mini::toIntVec(${src});`);
    else if (t === "vector<vector<char>>") lines.push(`  auto a${i} = mini::toCharVec2(${src});`);
    else if (t === "vector<char>") lines.push(`  auto a${i} = mini::toCharVec(${src});`);
    else if (t === "vector<string>") lines.push(`  auto a${i} = mini::toStrVec(${src});`);
    else if (t === "char") lines.push(`  char a${i} = mini::unquote(${src}).empty() ? ' ' : mini::unquote(${src})[0];`);
    else if (t === "int") lines.push(`  int a${i} = stoi(${src});`);
    else if (t === "double") lines.push(`  double a${i} = stod(${src});`);
    else if (t === "bool") lines.push(`  bool a${i} = ${src} == "true";`);
    else if (t === "string") lines.push(`  string a${i} = mini::unquote(${src});`);
    else return null;
  }
  return lines.join("\n");
}

function cppCompare(retType: string, orderless: boolean): string | null {
  switch (retType) {
    case "integer[]":
      return orderless
        ? "mini::sameInts(result, mini::toIntVec(expectedRaw))"
        : "result == mini::toIntVec(expectedRaw)";
    // Was missing entirely, which sent every `string[]` problem down the "unsupported
    // signature" branch and made `renderStrings` unreachable — so the `got` value was never
    // reported even when the harness could have produced it.
    case "string[]":
      return "result == mini::toStrVec(expectedRaw)";
    case "list<list<string>>":
      return "mini::sameStrVec2(result, mini::toStrVec2(expectedRaw))";
    case "boolean":
      return 'string(result ? "true" : "false") == mini::trim(expectedRaw)';
    case "integer":
      return "to_string(result) == mini::trim(expectedRaw)";
    case "string":
      return "mini::unquote(mini::trim(expectedRaw)) == result";
    default:
      return null;
  }
}

function cppRender(retType: string): string | null {
  switch (retType) {
    case "integer[]":
      return "mini::renderInts(result)";
    case "boolean":
      return 'string(result ? "true" : "false")';
    case "integer":
      return "to_string(result)";
    // A quoted, escaped JSON string: the emit site writes `got` as a JSON VALUE, so the
    // quotes come from the render expression rather than from the surrounding literal.
    case "string":
      return "mini::jsonString(result)";
    case "string[]":
      return "mini::renderStrings(result)";
    case "list<list<string>>":
      return "mini::renderStrVec2(result)";
    default:
      return null;
  }
}

async function cppProgram(code: string, payload: Payload, meta: ProblemMeta | null): Promise<string> {
  const template = await Bun.file(resourcePath("harnesses/main.cpp.txt")).text();
  const b64 = Buffer.from(payloadLiteral(payload), "utf8").toString("base64");

  const unpack = cppUnpack(meta);
  const retType = meta?.return?.type ?? "";
  const compare = cppCompare(retType, payload.orderless);
  const render = cppRender(retType);
  // The call must use the unpacked locals (a0, a1, ...), not the declared parameter names —
  // those exist only in the user's signature, not in this scope.
  const callArgs = meta?.params?.map((_, i) => `a${i}`).join(", ") ?? "";

  // Without a supported signature, emit a harness that reports the limitation, so a failure
  // never looks like a pass or an opaque compile error.
  const body =
    unpack !== null && compare !== null && render !== null
      ? `  string argsBody = mini::trim(cases[i].args);
  if (!argsBody.empty() && argsBody.front() == '[') argsBody = argsBody.substr(1, argsBody.size() - 2);
  string expectedRaw = cases[i].expected;
${unpack}
  auto result = sol.${payload.fn}(${callArgs});
  bool okv = ${compare};
  if (okv) passed++;
  cout << ",\\"got\\":" << ${render} << ",\\"pass\\":" << (okv ? "true" : "false");`
      : `  cout << ",\\"got\\":null,\\"pass\\":false,\\"error\\":\\"unsupported signature for ${payload.fn} (${retType || "unknown return"})\\"";`;

  return template
    .replace("__PAYLOAD_B64__", b64)
    .replace("__USER_CODE__", code)
    .replace("__HARNESS_BODY__", body);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

type ProgramFn = (
  code: string,
  payload: Payload,
  meta: ProblemMeta | null,
  extraImports: string[],
) => string | Promise<string>;

const PROGRAMS: Record<LanguageId, ProgramFn> = {
  python3: (c, p) => pythonProgram(c, p),
  javascript: (c, p) => javascriptProgram(c, p),
  java: (c, p) => javaProgram(c, p),
  cpp: (c, p, m) => cppProgram(c, p, m),
  go: (c, p, _m, extra) => goProgram(c, p, extra),
};

/**
 * Execute user code against parsed cases.
 *
 * Never throws on user error — a compile failure or a crash comes back as a failed result
 * carrying the compiler/runtime message, because that message is what the student needs.
 */
export async function runInLanguage(opts: {
  language: string;
  code: string;
  fnName: string;
  cases: Array<{ args: unknown[]; expected: unknown; orderless?: boolean }>;
  /** Required for C++, whose harness is generated from the parameter types. */
  meta?: ProblemMeta | null;
  /**
   * Standard-library packages the user's code needs. Go only: a Go import declaration must
   * precede all other declarations, and the user's code is spliced in after the harness's, so
   * user code cannot import anything on its own. Ignored by every other language.
   */
  extraImports?: string[];
  timeoutMs?: number;
}): Promise<RunResult> {
  const lang = languageById(opts.language);
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const started = Date.now();

  const payload: Payload = {
    cases: opts.cases.map((c) => ({ args: c.args, expected: c.expected })),
    fn: opts.fnName,
    orderless: opts.cases.some((c) => c.orderless),
  };

  const dir = join(tmpdir(), `prep_${lang.id}_${crypto.randomUUID()}`);

  const fail = (message: string): RunResult => ({
    cases: [],
    passed: 0,
    total: opts.cases.length,
    accepted: false,
    durationMs: Date.now() - started,
    stderr: message,
  });

  /**
   * Kill a spawned command and everything it spawned.
   *
   * `proc.kill()` targets the direct child only. `go run` compiles and then execs the binary as a
   * GRANDCHILD, so an infinite loop in a Go submission left the grandchild holding the stdout pipe:
   * `await new Response(proc.stdout).text()` never saw EOF and `run()` never returned, hanging the
   * request forever and skipping the `finally` that removes the temp directory.
   *
   * POSIX has process groups, so the child is spawned detached and the group is signalled.
   * Windows has none — `process.kill(-pid)` throws there — so `taskkill /T` walks the child tree
   * instead. Falling back to `proc.kill()` in both cases keeps a failure to kill from throwing out
   * of the timer.
   */
  const killTree = (proc: { pid: number; kill: () => void }) => {
    try {
      if (process.platform === "win32") {
        Bun.spawnSync(["taskkill", "/PID", String(proc.pid), "/T", "/F"], {
          stdout: "ignore",
          stderr: "ignore",
        });
      } else {
        process.kill(-proc.pid, "SIGKILL");
      }
    } catch {
      proc.kill();
    }
  };

  /**
   * Whether to put the child in its own process group.
   *
   * POSIX only, and not merely because Windows lacks the concept: spawning `go run` detached on
   * Windows made it fail with `error obtaining buildID for go tool compile` and take 41 s instead
   * of 1.2 s, because the Go toolchain does not tolerate the detached console. `taskkill /T` walks
   * the child tree without needing a group, so Windows loses nothing.
   */
  const DETACH = process.platform !== "win32";

  const run = async (cmd: string[], timeout: number) => {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", cwd: dir, detached: DETACH });
    const killer = setTimeout(() => killTree(proc), timeout);
    try {
      const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      return { code: await proc.exited, out, err };
    } finally {
      clearTimeout(killer);
    }
  };

  try {
    // `mkdir` and `writeFile` are INSIDE the try whose `finally` removes the directory. Outside it,
    // a throw from `PROGRAMS[...]` — an unreadable harness template, say — orphaned
    // `%TEMP%/prep_<lang>_<uuid>/` on every attempt.
    await mkdir(dir, { recursive: true });
    // A public Java class must live in a file matching its name, so Java gets Main.java from
    // the start rather than being written then renamed — the rename raced javac.
    const file = join(dir, lang.id === "java" ? "Main.java" : `main.${lang.ext}`);
    await writeFile(file, await PROGRAMS[lang.id](opts.code, payload, opts.meta ?? null, opts.extraImports ?? []), "utf8");
    if (lang.id === "cpp") {
      const exe = join(dir, "prog.exe");
      const build = await run(["g++", "-O0", "-std=c++17", "-o", exe, file], timeoutMs);
      if (build.code !== 0) return fail(`compile failed:\n${build.err.slice(0, 1500)}`);
      const r = await run([exe], timeoutMs);
      return finish(r.out, r.err, opts.cases.length, started, r.code);
    }

    if (lang.id === "java") {
      const build = await run(["javac", "-d", dir, file], timeoutMs);
      if (build.code !== 0) return fail(`compile failed:\n${build.err.slice(0, 1500)}`);
      const r = await run(["java", "-cp", dir, "Main"], timeoutMs);
      return finish(r.out, r.err, opts.cases.length, started, r.code);
    }

    if (lang.id === "go") {
      const first = await run([...lang.command, file], timeoutMs);
      const missing = missingGoPackages(first.err);
      if (missing.length > 0) {
        // Retry once with the packages the compiler named. See `missingGoPackages`: Go
        // requires imports to precede all declarations and the harness splices user code
        // after its own imports, so a submission cannot import anything itself.
        const retryFile = join(dir, `main_retry.${lang.ext}`);
        const imports = [...new Set([...(opts.extraImports ?? []), ...missing])];
        await writeFile(retryFile, await goProgram(opts.code, payload, imports), "utf8");
        const second = await run([...lang.command, retryFile], timeoutMs);
        return finish(second.out, second.err, opts.cases.length, started, second.code);
      }
      return finish(first.out, first.err, opts.cases.length, started, first.code);
    }

    const r = await run([...lang.command, file], timeoutMs);
    return finish(r.out, r.err, opts.cases.length, started, r.code);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Standard-library packages a Go compile failed on, as `undefined: sort` style errors.
 *
 * Go requires every `import` to precede all other declarations, and the harness emits its own
 * imports BEFORE splicing in the user's code — so a submission cannot import anything itself.
 * Without this, `sort.Slice`, `strings.Fields` and `container/heap` were simply unavailable and
 * a correct solution failed to compile.
 *
 * Only the standard library is considered, and only packages the compiler NAMED. A submission
 * that references a genuinely undefined identifier still fails, as it should.
 */
const GO_STDLIB = [
  "sort", "strings", "math", "strconv", "container/heap", "unicode", "bytes", "slices", "maps",
  "errors", "fmt", "time", "regexp", "math/bits", "math/rand",
];

function missingGoPackages(stderr: string): string[] {
  const found = new Set<string>();
  for (const pkg of GO_STDLIB) {
    // Go reports the symbol without its package path: `undefined: sort`, `undefined: heap`.
    const symbol = pkg.includes("/") ? pkg.split("/").pop()! : pkg;
    const re = new RegExp(`undefined:\\s*${symbol.replace(/[/\\]/g, "\\$&")}\\b`);
    if (re.test(stderr)) found.add(pkg);
  }
  return [...found];
}

function finish(stdout: string, stderr: string, total: number, started: number, exitCode: number): RunResult {
  const durationMs = Date.now() - started;
  const line = stdout.trim().split("\n").filter(Boolean).pop();

  if (!line) {
    return {
      cases: [],
      passed: 0,
      total,
      accepted: false,
      durationMs,
      stderr: stderr.slice(0, 2000) || `no output (exit ${exitCode})`,
    };
  }

  let parsed: { fatal?: string; cases?: CaseResult[]; passed?: number; total?: number };
  try {
    parsed = JSON.parse(line);
  } catch {
    return {
      cases: [],
      passed: 0,
      total,
      accepted: false,
      durationMs,
      stderr: `harness emitted non-JSON: ${line.slice(0, 300)}`,
    };
  }

  if (parsed.fatal) {
    return { cases: [], passed: 0, total, accepted: false, durationMs, stderr: parsed.fatal };
  }

  const cases = parsed.cases ?? [];
  const passed = parsed.passed ?? 0;
  // `total` is the number of cases SENT, not the number the harness claims to have run. A harness
  // that silently skipped a malformed case reported a smaller total, so the count line could read
  // "N/N" over fewer cases than the suite holds — a green run that had not run everything. Both
  // harnesses now emit an explicit error record for a malformed case instead of dropping it, so the
  // two agree in practice; this keeps them agreeing if one ever regresses.
  return {
    cases,
    passed,
    total,
    accepted: passed === total && cases.length > 0,
    durationMs,
    ...(stderr.trim() ? { stderr: stderr.slice(0, 2000) } : {}),
  };
}

export { LANGUAGES };
