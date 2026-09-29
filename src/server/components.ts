/**
 * Executable system-design components: the runtime.
 *
 * A one-for-one mirror of `concepts.ts`: seed the catalogue into a table, read it back, run a
 * submission through the shared executor, and schedule a pass on the same FSRS curve. The
 * differences are the table name, the module vocabulary, and the `op_format` column.
 *
 * `metaFor` is imported from `concepts.ts`, not copied. Its type-inference rule (scan every
 * test case, not just the first, because an empty expected array is type-ambiguous on its
 * own) is worth not writing twice.
 */

import { db } from "./db.ts";
import { runInLanguage, type ProblemMeta, type RunResult } from "./runner.ts";
import { gradeAttempt, reviewItem } from "./srs.ts";
import { metaFor } from "./concepts.ts";
import { fnNameFor } from "./concepts/catalog.ts";
import {
  COMPONENTS,
  MODULE_LABEL,
  MODULE_ORDER,
  type ComponentModule,
  type ComponentSpec,
} from "./components/catalog.ts";
import { PYTHON } from "./components/python3.ts";
import { JAVASCRIPT } from "./components/javascript.ts";
import { JAVA } from "./components/java.ts";
import { CPP } from "./components/cpp.ts";
import { GO } from "./components/go.ts";

export type ComponentExercise = {
  id: number;
  lang: string;
  slug: string;
  module: ComponentModule;
  title: string;
  conceptMd: string;
  promptMd: string;
  opFormat: string;
  starter: string;
  solution: string;
  fnName: string;
  tests: Array<{ args: unknown[]; expected: unknown }>;
  prereq: string[] | null;
};

/** Per-language code, keyed by component slug. */
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

/** `fnNameFor` lives with the concept catalogue; the naming rule is shared, not per-track. */
export { fnNameFor } from "./concepts/catalog.ts";

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * Write the catalogue into `component_exercises`.
 *
 * Idempotent and self-correcting, like `seedConcepts`: an edited component updates in place,
 * so the table is never a stale copy of the source.
 */
export function seedComponents(): number {
  const insert = db.query(
    `INSERT INTO component_exercises
       (lang, slug, module, title, concept_md, prompt_md, op_format, starter, solution,
        fn_name, tests, prereq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(lang, slug) DO UPDATE SET
       module = excluded.module, title = excluded.title, concept_md = excluded.concept_md,
       prompt_md = excluded.prompt_md, op_format = excluded.op_format,
       starter = excluded.starter, solution = excluded.solution, fn_name = excluded.fn_name,
       tests = excluded.tests, prereq = excluded.prereq`,
  );

  let n = 0;
  db.transaction(() => {
    for (const lang of LANGS) {
      const code = CODE[lang] ?? {};
      for (const spec of COMPONENTS) {
        const impl = code[spec.slug];
        if (!impl) throw new Error(`components: ${lang} has no code for "${spec.slug}"`);
        insert.run(
          lang,
          `${lang}/${spec.slug}`,
          spec.module,
          spec.title,
          spec.conceptMd,
          spec.promptMd,
          spec.opFormat,
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
  op_format: string;
  starter: string;
  solution: string;
  fn_name: string;
  tests: string;
  prereq: string | null;
  /** 1 when an item_cards row exists, i.e. the component has been passed at least once. */
  reviewed: number;
};

const SELECT = `
  SELECT c.id, c.lang, c.slug, c.module, c.title, c.concept_md, c.prompt_md, c.op_format,
         c.starter, c.solution, c.fn_name, c.tests, c.prereq,
         CASE WHEN EXISTS (SELECT 1 FROM item_cards ic WHERE ic.item_id = i.id) THEN 1 ELSE 0 END AS reviewed
  FROM component_exercises c
  LEFT JOIN items i ON i.kind = 'component' AND i.ref = c.slug
`;

function toExercise(r: Row): ComponentExercise {
  return {
    id: r.id,
    lang: r.lang,
    slug: r.slug,
    module: r.module as ComponentModule,
    title: r.title,
    conceptMd: r.concept_md,
    promptMd: r.prompt_md,
    opFormat: r.op_format,
    starter: r.starter,
    solution: r.solution,
    fnName: r.fn_name,
    tests: JSON.parse(r.tests) as Array<{ args: unknown[]; expected: unknown }>,
    prereq: r.prereq ? r.prereq.split(",").filter(Boolean) : null,
  };
}

export type ComponentSummary = {
  slug: string;
  lang: string;
  module: ComponentModule;
  moduleLabel: string;
  title: string;
  reviewed: boolean;
  prereq: string[] | null;
};

/** Every component, optionally filtered to one language, with a passed marker. */
export function listComponents(lang?: string): ComponentSummary[] {
  const rows = lang
    ? db.query<Row, [string]>(`${SELECT} WHERE c.lang = ? ORDER BY c.id`).all(lang)
    : db.query<Row, []>(`${SELECT} ORDER BY c.id`).all();

  return rows.map((r) => ({
    slug: r.slug,
    lang: r.lang,
    module: r.module as ComponentModule,
    moduleLabel: MODULE_LABEL[r.module as ComponentModule] ?? r.module,
    title: r.title,
    reviewed: r.reviewed === 1,
    prereq: r.prereq ? r.prereq.split(",").filter(Boolean) : null,
  }));
}

/** Modules in teaching order, with their components. */
export function componentModules(
  lang?: string,
): Array<{ module: ComponentModule; label: string; components: ComponentSummary[] }> {
  const all = listComponents(lang);
  const byModule = new Map<string, ComponentSummary[]>();
  for (const c of all) {
    const bucket = byModule.get(c.module) ?? [];
    bucket.push(c);
    byModule.set(c.module, bucket);
  }

  return MODULE_ORDER.filter((m) => byModule.has(m)).map((m) => ({
    module: m,
    label: MODULE_LABEL[m],
    components: byModule.get(m)!,
  }));
}

export function getComponent(slug: string): ComponentExercise | null {
  const row = db.query<Row, [string]>(`${SELECT} WHERE c.slug = ?`).get(slug);
  return row ? toExercise(row) : null;
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/**
 * Execute a component submission.
 *
 * Same executor and harnesses as a DSA problem. `orderless` is left unset on purpose: every
 * component asserts a specific output ORDER (the sequence of `get` results, the sorted
 * postings, the ring's answer per key), so marking any of them orderless would let a wrong
 * answer pass.
 */
export async function runComponent(slug: string, code: string): Promise<RunResult> {
  const exercise = getComponent(slug);
  if (!exercise) throw new Error(`unknown component: ${slug}`);

  const spec = COMPONENTS.find((c) => c.slug === slug.split("/").slice(1).join("/"));
  if (!spec) throw new Error(`component not in the catalogue: ${slug}`);

  return runInLanguage({
    language: exercise.lang,
    code,
    fnName: exercise.fnName,
    cases: exercise.tests.map((t) => ({ args: t.args, expected: t.expected })),
    meta: metaFor(spec as unknown as ComponentSpec),
    extraImports: spec.goImports ?? [],
  });
}

/**
 * Record a passed component and schedule it for review.
 *
 * The `items` row is inserted before the `item_cards` row because `item_cards.item_id`
 * references `items(id)` and foreign keys are on.
 *
 * The grade comes from `gradeAttempt`, the same behavioural derivation the DSA and concept
 * paths use. A component is not an exception: the tests passed or they did not.
 */
export function recordComponent(
  slug: string,
  result: { accepted: boolean; passed: number; total: number },
  seconds: number,
): { grade: number; due: string | null; intervalDays: number | null } {
  const exercise = getComponent(slug);
  if (!exercise) throw new Error(`unknown component: ${slug}`);

  const grade = gradeAttempt({
    passed: result.accepted,
    hintsUsed: 0,
    solutionUnlocked: false,
    seconds,
  });

  // Nothing attempted (a compile error, say) is not evidence either way, so it is not
  // scheduled. Same rule the DSA path uses for `testsPassed === 0`.
  if (!result.accepted && result.passed === 0) {
    return { grade, due: null, intervalDays: null };
  }

  // The `items` row and the `item_cards` row are one transaction. `item_cards.item_id` references
  // `items(id)` with foreign keys on, and a crash between the two would leave an item with no
  // schedule — or, worse, a schedule advanced with no record of why.
  const schedule = db.transaction((): { due: Date; intervalDays: number } => {
    const itemId = ensureItem(exercise);
    return reviewItem(itemId, grade);
  })();
  return { grade, due: schedule.due.toISOString(), intervalDays: schedule.intervalDays };
}

/** The `items` row for a component, created on first use. */
function ensureItem(exercise: ComponentExercise): number {
  db.run(
    `INSERT INTO items (kind, ref, title, body_md) VALUES ('component', ?, ?, ?)
     ON CONFLICT(kind, ref) DO UPDATE SET title = excluded.title, body_md = excluded.body_md`,
    [exercise.slug, exercise.title, exercise.conceptMd],
  );
  const row = db
    .query<{ id: number }, [string]>("SELECT id FROM items WHERE kind = 'component' AND ref = ?")
    .get(exercise.slug);
  if (!row) throw new Error(`failed to create item row for ${exercise.slug}`);
  return row.id;
}

export type { ComponentSpec, ComponentModule, ProblemMeta };
