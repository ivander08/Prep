/**
 * Pre-DSA language fundamentals — the runtime.
 *
 * A concept is graded through the SAME executor the DSA problems use (`runInLanguage`), so
 * there is no second execution path to keep correct. The only concept-specific machinery is:
 *
 *   1. The catalogue is seeded into `concept_exercises` so it is queryable and so a content
 *      edit is a row update rather than a redeploy.
 *   2. Each concept's `meta` (parameter and return types) is DERIVED from its own tests.
 *      C++ cannot generate a call site without it, and hand-writing 31 signatures in
 *      LeetCode's type vocabulary is 31 chances to typo a type that then fails at compile
 *      time in a language nobody is looking at.
 *   3. Passing records an `items` row and schedules it through `item_cards`, using the same
 *      behavioural grade the DSA path uses. `items`/`item_cards` were created in 001 for
 *      exactly this and have been unused since.
 */

import { db } from "./db.ts";
import { runInLanguage, type ProblemMeta, type RunResult } from "./runner.ts";
import { gradeAttempt, reviewItem } from "./srs.ts";
import { CONCEPTS, MODULE_LABEL, MODULE_ORDER, fnNameFor, type Module } from "./concepts/catalog.ts";
import { PYTHON } from "./concepts/python3.ts";
import { JAVASCRIPT } from "./concepts/javascript.ts";
import { JAVA } from "./concepts/java.ts";
import { CPP } from "./concepts/cpp.ts";
import { GO } from "./concepts/go.ts";

export type ConceptExercise = {
  id: number;
  lang: string;
  slug: string;
  module: Module;
  title: string;
  conceptMd: string;
  promptMd: string;
  starter: string;
  solution: string;
  fnName: string;
  tests: Array<{ args: unknown[]; expected: unknown }>;
  prereq: string[] | null;
};

/** Per-language code, keyed by concept slug (without the `lang/` prefix). */
export const CODE: Record<string, Record<string, { starter: string; solution: string }>> = {
  python3: PYTHON,
  javascript: JAVASCRIPT,
  java: JAVA,
  cpp: CPP,
  go: GO,
};

export const LANG_LABEL: Record<string, string> = {
  python3: "Python 3",
  javascript: "JavaScript",
  java: "Java",
  cpp: "C++",
  go: "Go",
};

export const LANGS = ["python3", "javascript", "java", "cpp", "go"] as const;

// ---------------------------------------------------------------------------
// Type derivation
// ---------------------------------------------------------------------------

/**
 * LeetCode's type vocabulary, which is what `runInLanguage` and the C++ code generator
 * understand. Only these are emitted; the catalogue's tests are written to stay inside them
 * (no matrix inputs or returns — see catalog.ts).
 */
type LeanType = "integer" | "integer[]" | "string" | "string[]" | "boolean";

function leanTypeOf(value: unknown): LeanType | null {
  if (typeof value === "number") return "integer";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) {
    if (value.length === 0) return null; // not decidable from this case alone
    const inner = value.map(leanTypeOf);
    if (inner.every((t) => t === "integer")) return "integer[]";
    if (inner.every((t) => t === "string")) return "string[]";
    return null;
  }
  return null;
}

/**
 * Infer a parameter or return type by scanning EVERY test case.
 *
 * Scanning all cases rather than the first matters: `buildRange(0)` returns `[]`, which is
 * type-ambiguous on its own, but `buildRange(5)` returns `[0,1,2,3,4]` and settles it.
 */
function inferType(values: unknown[], fallback: LeanType): LeanType {
  for (const v of values) {
    const t = leanTypeOf(v);
    if (t) return t;
  }
  return fallback;
}

/** The `metaData` shape the runner needs, derived from the tests. */
export function metaFor(spec: (typeof CONCEPTS)[number]): ProblemMeta {
  const arity = Math.max(...spec.tests.map((t) => t.args.length));
  const params = [];
  for (let i = 0; i < arity; i++) {
    params.push({
      name: `a${i}`,
      type: inferType(spec.tests.map((t) => t.args[i]), "integer"),
    });
  }
  return {
    name: spec.name,
    params,
    return: { type: inferType(spec.tests.map((t) => t.expected), "integer") },
  };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * Write the catalogue into `concept_exercises`.
 *
 * Idempotent and self-correcting: an edited concept updates in place, so the table is never
 * a stale copy of the source. `ON CONFLICT` rather than `INSERT OR IGNORE` for exactly that
 * reason — ignoring would leave old prose behind after a fix.
 */
export function seedConcepts(): number {
  const insert = db.query(
    `INSERT INTO concept_exercises
       (lang, slug, module, title, concept_md, prompt_md, starter, solution, fn_name, tests, prereq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(lang, slug) DO UPDATE SET
       module = excluded.module, title = excluded.title, concept_md = excluded.concept_md,
       prompt_md = excluded.prompt_md, starter = excluded.starter, solution = excluded.solution,
       fn_name = excluded.fn_name, tests = excluded.tests, prereq = excluded.prereq`,
  );

  let n = 0;
  db.transaction(() => {
    for (const lang of LANGS) {
      const code = CODE[lang] ?? {};
      for (const spec of CONCEPTS) {
        const impl = code[spec.slug];
        if (!impl) {
          throw new Error(`concepts: ${lang} has no code for "${spec.slug}"`);
        }
        insert.run(
          lang,
          `${lang}/${spec.slug}`,
          spec.module,
          spec.title,
          spec.conceptMd,
          spec.promptMd,
          impl.starter,
          impl.solution,
          fnNameFor(lang, spec.name),
          JSON.stringify(spec.tests),
          spec.prereq?.join(",") ?? null,
        );
        n++;
      }
    }
  })();

  return n;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type Row = {
  id: number;
  lang: string;
  slug: string;
  module: string;
  title: string;
  concept_md: string;
  prompt_md: string;
  starter: string;
  solution: string;
  fn_name: string;
  tests: string;
  prereq: string | null;
  /** 1 when an item_cards row exists, i.e. the concept has been passed at least once. */
  reviewed: number;
};

const SELECT = `
  SELECT c.id, c.lang, c.slug, c.module, c.title, c.concept_md, c.prompt_md, c.starter,
         c.solution, c.fn_name, c.tests, c.prereq,
         CASE WHEN EXISTS (SELECT 1 FROM item_cards ic WHERE ic.item_id = i.id) THEN 1 ELSE 0 END AS reviewed
  FROM concept_exercises c
  LEFT JOIN items i ON i.kind = 'concept' AND i.ref = c.slug
`;

function toExercise(r: Row): ConceptExercise {
  return {
    id: r.id,
    lang: r.lang,
    slug: r.slug,
    module: r.module as Module,
    title: r.title,
    conceptMd: r.concept_md,
    promptMd: r.prompt_md,
    starter: r.starter,
    solution: r.solution,
    fnName: r.fn_name,
    tests: JSON.parse(r.tests) as Array<{ args: unknown[]; expected: unknown }>,
    prereq: r.prereq ? r.prereq.split(",").filter(Boolean) : null,
  };
}

export type ConceptSummary = {
  slug: string;
  lang: string;
  module: Module;
  moduleLabel: string;
  title: string;
  reviewed: boolean;
  prereq: string[] | null;
};

/** Every concept, optionally filtered to one language, with a passed marker. */
export function listConcepts(lang?: string): ConceptSummary[] {
  const rows = lang
    ? db.query<Row, [string]>(`${SELECT} WHERE c.lang = ? ORDER BY c.id`).all(lang)
    : db.query<Row, []>(`${SELECT} ORDER BY c.id`).all();

  return rows.map((r) => ({
    slug: r.slug,
    lang: r.lang,
    module: r.module as Module,
    moduleLabel: MODULE_LABEL[r.module as Module] ?? r.module,
    title: r.title,
    reviewed: r.reviewed === 1,
    prereq: r.prereq ? r.prereq.split(",").filter(Boolean) : null,
  }));
}

/** Modules in teaching order, with their concepts. */
export function conceptModules(lang?: string): Array<{ module: Module; label: string; concepts: ConceptSummary[] }> {
  const all = listConcepts(lang);
  const byModule = new Map<string, ConceptSummary[]>();
  for (const c of all) {
    const bucket = byModule.get(c.module) ?? [];
    bucket.push(c);
    byModule.set(c.module, bucket);
  }

  return MODULE_ORDER.filter((m) => byModule.has(m)).map((m) => ({
    module: m,
    label: MODULE_LABEL[m],
    concepts: byModule.get(m)!,
  }));
}

export function getConcept(slug: string): ConceptExercise | null {
  const row = db.query<Row, [string]>(`${SELECT} WHERE c.slug = ?`).get(slug);
  return row ? toExercise(row) : null;
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/**
 * Execute a concept submission.
 *
 * Same executor, same harnesses as a DSA problem. `orderless` is deliberately left unset:
 * several concepts assert a specific ordering (a stable sort, a transpose, a sliding-window
 * scan), and marking them orderless would make those tests pass for the wrong answer.
 */
export async function runConcept(slug: string, code: string): Promise<RunResult> {
  const exercise = getConcept(slug);
  if (!exercise) throw new Error(`unknown concept: ${slug}`);

  const spec = CONCEPTS.find((c) => c.slug === slug.split("/").slice(1).join("/"));
  if (!spec) throw new Error(`concept not in the catalogue: ${slug}`);

  return runInLanguage({
    language: exercise.lang,
    code,
    fnName: exercise.fnName,
    cases: exercise.tests.map((t) => ({ args: t.args, expected: t.expected })),
    meta: metaFor(spec),
    extraImports: spec.goImports ?? [],
  });
}

/**
 * Record a passed concept and schedule it for review.
 *
 * The `items` row is inserted before the `item_cards` row because `item_cards.item_id`
 * references `items(id)` and foreign keys are on.
 *
 * The grade comes from `gradeAttempt` — the same behavioural derivation the DSA path uses.
 * There is no self-rating anywhere in this app, and a concept is not an exception: the tests
 * passed or they did not, and that is the grade.
 */
export function recordConcept(
  slug: string,
  result: { accepted: boolean; passed: number; total: number },
  seconds: number,
): { grade: number; due: string | null; intervalDays: number | null } {
  const exercise = getConcept(slug);
  if (!exercise) throw new Error(`unknown concept: ${slug}`);

  const grade = gradeAttempt({
    passed: result.accepted,
    hintsUsed: 0,
    solutionUnlocked: false,
    seconds,
  });

  // Nothing attempted (a compile error, say) is not evidence either way, so it is not
  // scheduled — same rule the DSA path uses for `testsPassed === 0`.
  if (!result.accepted && result.passed === 0) {
    return { grade, due: null, intervalDays: null };
  }

  const itemId = ensureItem(exercise);
  const schedule = reviewItem(itemId, grade);
  return { grade, due: schedule.due.toISOString(), intervalDays: schedule.intervalDays };
}

/** The `items` row for a concept, created on first use. */
function ensureItem(exercise: ConceptExercise): number {
  db.run(
    `INSERT INTO items (kind, ref, title, body_md) VALUES ('concept', ?, ?, ?)
     ON CONFLICT(kind, ref) DO UPDATE SET title = excluded.title, body_md = excluded.body_md`,
    [exercise.slug, exercise.title, exercise.conceptMd],
  );
  const row = db
    .query<{ id: number }, [string]>("SELECT id FROM items WHERE kind = 'concept' AND ref = ?")
    .get(exercise.slug);
  if (!row) throw new Error(`failed to create item row for ${exercise.slug}`);
  return row.id;
}
