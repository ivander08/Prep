/**
 * Concept exemplar verifier.
 *   bun run src/server/concepts/verify.ts [lang]
 * Runs every exemplar for one language (or all five) against its own tests, through the real
 * executor. A wrong exemplar fails immediately, in the language it is wrong in, instead of
 * shipping as a "solution" a student is supposed to learn from. It also checks the starter
 * fails: a starter that already passes teaches nothing, and that is easy to produce by accident
 * when the scaffold is faded too gently.
 * Standalone on purpose: it imports the language files directly, not through `concepts.ts`, so
 * a language whose file is still being written does not block verifying the others.
 */

import { CONCEPTS, fnNameFor } from "./catalog.ts";
import { runInLanguage, type ProblemMeta } from "../runner.ts";

type LeanType = "integer" | "integer[]" | "string" | "string[]" | "boolean";

function leanTypeOf(value: unknown): LeanType | null {
  if (typeof value === "number") return "integer";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const inner = value.map(leanTypeOf);
    if (inner.every((t) => t === "integer")) return "integer[]";
    if (inner.every((t) => t === "string")) return "string[]";
    return null;
  }
  return null;
}

function inferType(values: unknown[], fallback: LeanType): LeanType {
  for (const v of values) {
    const t = leanTypeOf(v);
    if (t) return t;
  }
  return fallback;
}

function metaFor(spec: (typeof CONCEPTS)[number]): ProblemMeta {
  const arity = Math.max(...spec.tests.map((t) => t.args.length));
  const params = [];
  for (let i = 0; i < arity; i++) {
    params.push({ name: `a${i}`, type: inferType(spec.tests.map((t) => t.args[i]), "integer") });
  }
  return {
    name: spec.name,
    params,
    return: { type: inferType(spec.tests.map((t) => t.expected), "integer") },
  };
}

const LANGS = ["python3", "javascript", "java", "cpp", "go"] as const;
type Lang = (typeof LANGS)[number];

async function loadCode(lang: Lang): Promise<Record<string, { starter: string; solution: string }>> {
  const mod = await import(`./${lang}.ts`);
  const key = { python3: "PYTHON", javascript: "JAVASCRIPT", java: "JAVA", cpp: "CPP", go: "GO" }[lang];
  const code = mod[key];
  if (!code) throw new Error(`${lang}.ts does not export ${key}`);
  return code as Record<string, { starter: string; solution: string }>;
}

type Finding = { slug: string; problem: string; detail: string };

async function verifyLang(lang: Lang): Promise<{ checked: number; findings: Finding[] }> {
  const code = await loadCode(lang);
  const findings: Finding[] = [];

  for (const spec of CONCEPTS) {
    const impl = code[spec.slug];
    if (!impl) {
      findings.push({ slug: spec.slug, problem: "missing", detail: `${lang}.ts has no entry` });
      continue;
    }

    const cases = spec.tests.map((t) => ({ args: t.args, expected: t.expected }));
    const meta = metaFor(spec);
    const fn = fnNameFor(lang, spec.name);
    const extraImports = spec.goImports ?? [];

    const sol = await runInLanguage({ language: lang, code: impl.solution, fnName: fn, cases, meta, extraImports });
    if (!sol.accepted) {
      const first = sol.cases.find((c) => !c.pass);
      findings.push({
        slug: spec.slug,
        problem: "solution fails",
        detail:
          `${sol.passed}/${sol.total}` +
          (first
            ? ` · case args=${JSON.stringify(first.args)} expected=${JSON.stringify(first.expected)} got=${JSON.stringify(first.got)}${first.error ? ` error=${first.error}` : ""}`
            : "") +
          (sol.stderr ? ` · stderr=${sol.stderr.slice(0, 300)}` : ""),
      });
      continue;
    }

    const st = await runInLanguage({ language: lang, code: impl.starter, fnName: fn, cases, meta, extraImports });
    if (st.accepted) {
      findings.push({ slug: spec.slug, problem: "starter already passes", detail: "the scaffold gives away the answer" });
    } else if (st.stderr && /compile failed|unsupported signature/.test(st.stderr)) {
      // A starter that does not compile is a worse lesson than one that runs and fails.
      findings.push({ slug: spec.slug, problem: "starter does not compile", detail: st.stderr.slice(0, 300) });
    }
  }

  return { checked: CONCEPTS.length, findings };
}

const requested = process.argv[2] as Lang | undefined;
const langs = requested ? [requested] : [...LANGS];
let totalFindings = 0;

for (const lang of langs) {
  process.stdout.write(`\n=== ${lang} ===\n`);
  let result: { checked: number; findings: Finding[] };
  try {
    result = await verifyLang(lang);
  } catch (e) {
    console.log(`  LOAD FAILED: ${String(e).slice(0, 400)}`);
    totalFindings++;
    continue;
  }
  if (result.findings.length === 0) {
    console.log(`  all ${result.checked} exemplars pass their own tests, and every starter fails`);
  } else {
    for (const f of result.findings) {
      console.log(`  ${f.slug.padEnd(26)} ${f.problem}: ${f.detail}`);
    }
    totalFindings += result.findings.length;
  }
}

console.log(`\n${totalFindings === 0 ? "OK" : `${totalFindings} finding(s)`}`);
process.exit(totalFindings === 0 ? 0 : 1);
