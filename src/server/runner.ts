/**
 * Multi-language execution.
 *
 * Each language gets its own harness rather than a shared abstraction, because the binding
 * rule genuinely differs:
 *
 *   python3     `class Solution:` + method taking `self`  -> instantiate and bind
 *   javascript  `var twoSum = function(...)`              -> bare function, no class
 *   java        `class Solution { public ... }`           -> instantiate and bind
 *   cpp         `class Solution { public: ... }`          -> instantiate and bind
 *   go          `func twoSum(...)`                        -> bare function, no class
 *
 * Getting this wrong fails EVERY submission rather than failing loudly, so each language is
 * verified against a known-good and a known-bad solution in runner.test.ts.
 *
 * Java and C++ harnesses live in `harnesses/` as real files. Generating them from string
 * templates meant every backslash and quote had to survive three escaping layers (source,
 * template, target language), and it repeatedly produced uncompilable code. A file has
 * nothing to escape. C++ additionally needs type-directed codegen, because a statically
 * typed language cannot build a generic call site the way the other four manage.
 *
 * Windows detail: a compiled binary must be invoked by its absolute path. A POSIX-style
 * `./name` returns "command not found" (exit 127) even when the file exists.
 */

import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LANGUAGES, languageById, type LanguageId } from "./languages.ts";

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
 * stream — concatenating them onto stdin made `json.loads()` fail on every run.
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
 * `extraImports` is load-bearing for the concepts track. A Go file's import declarations must
 * precede every other declaration, and the user's code is spliced in after the harness's own
 * imports — so user code CANNOT add an import of its own. Without this, a Go concept could not
 * use `sort` or `strings`, and "sort this" is not a lesson you can teach with a hand-rolled
 * bubble sort. The imports are emitted as a second import block, which Go allows; nothing is
 * added by default because Go rejects unused imports, so a blanket list would break every
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

  const template = await Bun.file(join(import.meta.dir, "harnesses/Main.java.txt")).text();
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
    else if (t === "vector<string>") lines.push(`  auto a${i} = mini::toStrVec(${src});`);
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
  const template = await Bun.file(join(import.meta.dir, "harnesses/main.cpp.txt")).text();
  const b64 = Buffer.from(payloadLiteral(payload), "utf8").toString("base64");

  const unpack = cppUnpack(meta);
  const retType = meta?.return?.type ?? "";
  const compare = cppCompare(retType, payload.orderless);
  const render = cppRender(retType);
  // The call must use the unpacked locals (a0, a1, ...), not the declared parameter names —
  // those exist only in the user's signature, not in this scope.
  const callArgs = meta?.params?.map((_, i) => `a${i}`).join(", ") ?? "";

  // Without a supported signature, emit a harness that reports the limitation rather than
  // one that silently passes or fails to compile with a confusing error.
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
  await mkdir(dir, { recursive: true });
  // A public Java class must live in a file matching its name, so Java gets Main.java from
  // the start rather than being written then renamed — the rename raced javac.
  const file = join(dir, lang.id === "java" ? "Main.java" : `main.${lang.ext}`);
  await writeFile(file, await PROGRAMS[lang.id](opts.code, payload, opts.meta ?? null, opts.extraImports ?? []), "utf8");

  const fail = (message: string): RunResult => ({
    cases: [],
    passed: 0,
    total: opts.cases.length,
    accepted: false,
    durationMs: Date.now() - started,
    stderr: message,
  });

  const run = async (cmd: string[], timeout: number) => {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", cwd: dir });
    const killer = setTimeout(() => proc.kill(), timeout);
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
        // Retry once with the packages the compiler named. See `missingGoPackages` — Go
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
  const t = parsed.total ?? total;
  return {
    cases,
    passed,
    total: t,
    accepted: passed === t && cases.length > 0,
    durationMs,
    ...(stderr.trim() ? { stderr: stderr.slice(0, 2000) } : {}),
  };
}

export { LANGUAGES };
