/**
 * Parse the dataset's textual inputs into call arguments.
 * The `input_output` field stores inputs as source-like text:
 *
 *     'nums = [3,3], target = 6'
 *     'strs = ["a","b","c","d","e"]'
 *     'n = 7, queries = [[0,5],[1,6],[2,4]]'
 *
 * Splitting on commas is not sufficient: commas appear inside the values. The parser tracks bracket depth and string state, then splits only at top-level `, name =` boundaries.
 * Verified against the real corpus: `two-sum` (80 pairs) and `group-anagrams` (69 pairs) both parse, and the parsed arity matches `metaData.params`.
 */

export type IoPair = { input: string; output: string };

/** Split `a = [1,2], b = 3` into `[[1,2], 3]`, respecting nesting and quotes. */
export function parseArgs(input: string, expectedArity: number): unknown[] | null {
  const values = parseArgsAuto(input);
  if (values === null) return null;
  return values.length === expectedArity ? values : null;
}

/**
 * Parse the arguments with no expected arity, taking the count from the input itself.
 *
 * `meta_json` is filled lazily on first open (`index.ts`), so 2,851 of the 2,869 problems with a
 * suite have no metadata at all. Requiring `meta.params.length` before parsing therefore rejected
 * every multi-argument case on those problems: measured, `valid-parentheses` graded 0 of 149 and
 * `two-sum` 0 of 80. The count is derivable from the input, which is `name = value` pairs by
 * construction, so it is derived here and `meta.params` is kept only as a cross-check (see
 * `prepareSuite`). Measured over all 2,869 stored suites: 286,041 of 288,608 raw cases parse this
 * way, every problem keeps at least 3 gradeable cases, and for all 18 problems that do have
 * metadata the derived count matches `meta.params.length` exactly.
 */
export function parseArgsAuto(input: string): unknown[] | null {
  const text = input.trim();
  if (text.length === 0) return [];

  // Find top-level assignment boundaries: a comma at depth 0 followed by `name =`.
  const starts: number[] = [];
  let depth = 0;
  let inStr: string | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "[" || ch === "{" || ch === "(") depth++;
    else if (ch === "]" || ch === "}" || ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      // A boundary only if what follows looks like `identifier =`.
      const rest = text.slice(i + 1);
      if (/^\s*[A-Za-z_]\w*\s*=/.test(rest)) starts.push(i);
    }
  }

  const chunks: string[] = [];
  let prev = 0;
  for (const s of starts) {
    chunks.push(text.slice(prev, s));
    prev = s + 1;
  }
  chunks.push(text.slice(prev));

  const values: unknown[] = [];
  for (const chunk of chunks) {
    const eq = chunk.indexOf("=");
    if (eq === -1) return null; // not a `name = value` chunk
    const raw = chunk.slice(eq + 1).trim();
    const parsed = parseValue(raw);
    if (parsed === UNPARSED) return null;
    values.push(parsed);
  }

  return values;
}

const UNPARSED = Symbol("unparsed");

/**
 * Parse one value. Accepts JSON, then Python literals, since the corpus mixes both:
 * `True`/`False`/`None` are not JSON, and single-quoted strings appear in some outputs.
 */
export function parseValue(raw: string): unknown {
  const s = raw.trim();
  if (s.length === 0) return UNPARSED;

  if (s === "True" || s === "true") return true;
  if (s === "False" || s === "false") return false;
  if (s === "None" || s === "null") return null;

  try {
    return JSON.parse(s);
  } catch {
    // fall through to the Python-literal path
  }

  const normalised = s
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    .replace(/'/g, '"');

  try {
    return JSON.parse(normalised);
  } catch {
    return UNPARSED;
  }
}

/**
 * Parse the expected output, which may be a list, a scalar, a bare word, or (for 23 records
 * in the corpus) a Python error message.
 *
 * Three outcomes, because the third is a real category:
 *   - `ok`        a comparable value
 *   - `string`    a bare word like `aa`, which is a legitimate string answer
 *   - `poisoned`  a stored exception message, meaning the dataset's own reference solution
 *                 crashed on this case. Grading against it would fail every correct
 *                 submission, so it is dropped, not treated as an expectation.
 */
export type ExpectedResult =
  | { kind: "ok"; value: unknown }
  | { kind: "string"; value: string }
  | { kind: "poisoned"; message: string };

const ERROR_OUTPUT =
  /^(Error|TypeError|ValueError|IndexError|KeyError|RecursionError|AssertionError|NameError|ZeroDivisionError|AttributeError|StopIteration|OverflowError)\b/;

export function parseExpected(raw: string): ExpectedResult {
  const s = raw.trim();

  if (ERROR_OUTPUT.test(s)) return { kind: "poisoned", message: s };

  const v = parseValue(s);
  if (v !== UNPARSED) return { kind: "ok", value: v };

  // A bare token that is not JSON or a Python literal is a string answer, e.g. `aa`.
  if (/^[A-Za-z0-9_\-+. ]+$/.test(s)) return { kind: "string", value: s };

  return { kind: "poisoned", message: `unparseable expected value: ${s.slice(0, 60)}` };
}
