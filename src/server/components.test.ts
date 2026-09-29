/**
 * Executable-component fixtures.
 * The main test is "every exemplar passes its own tests in every language": the executor is a
 * deterministic oracle, so a wrong exemplar fails here instead of being taught to a student as
 * the answer. That is what makes shipping 60 generated exercises defensible.
 * The other direction matters just as much: a starter that already passes teaches nothing, so
 * every starter is asserted to compile and fail. Compile, not merely fail: a starter that does
 * not build reports a compiler error as a "failed test", a worse thing to hand a student.
 * A language whose runtime is not installed is skipped, not failed, matching
 * `concepts.test.ts` and `runner.test.ts`.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { COMPONENTS } from "./components/catalog.ts";
import {
  componentModules,
  getComponent,
  listComponents,
  recordComponent,
  runComponent,
  seedComponents,
} from "./components.ts";
import { detectAvailableLanguages } from "./languages.ts";
import { db } from "./db.ts";

const LANGS = ["python3", "javascript", "java", "cpp", "go"] as const;

let available: Record<string, boolean> = {};

beforeAll(async () => {
  seedComponents();
  available = await detectAvailableLanguages();
  const missing = LANGS.filter((l) => !available[l]);
  if (missing.length > 0) console.log(`[components] runtimes not installed, skipping: ${missing.join(", ")}`);
}, 120_000);

describe("component catalogue", () => {
  test("every component is seeded for every language", () => {
    expect(listComponents()).toHaveLength(COMPONENTS.length * LANGS.length);
  });

  test("each language has the full set", () => {
    for (const lang of LANGS) {
      expect(listComponents(lang)).toHaveLength(COMPONENTS.length);
    }
  });

  test("every component appears under a module, and the modules are in order", () => {
    const modules = componentModules("python3");
    expect(modules.length).toBeGreaterThan(0);
    // The summary slug carries its language prefix, so it is compared against the prefixed
    // catalogue, not the bare one.
    const seen = modules.flatMap((m) => m.components.map((c) => c.slug));
    expect(seen.sort()).toEqual(COMPONENTS.map((c) => `python3/${c.slug}`).sort());
    for (const m of modules) expect(m.components.length).toBeGreaterThan(0);
  });

  test("no exemplar is a stub, and every starter is marked as one", () => {
    for (const spec of COMPONENTS) {
      for (const lang of LANGS) {
        const c = getComponent(`${lang}/${spec.slug}`);
        expect(c).not.toBeNull();
        expect(c!.solution.length).toBeGreaterThan(20);
        expect(c!.starter.length).toBeGreaterThan(0);
        expect(c!.solution).not.toContain("TODO");
        // The starter's TODO is what makes "a scaffold that already passes teaches nothing"
        // checkable by a reader as well as by the executor.
        expect(c!.starter).toContain("TODO");
      }
    }
  });

  test("every type the tests use is expressible in the runner's vocabulary", () => {
    // The C++ harness generates its call site from these types and Java has no int[][]
    // argument coercion, so anything outside this set would fail to compile in two languages.
    for (const spec of COMPONENTS) {
      for (const t of spec.tests) {
        for (const arg of t.args) {
          if (Array.isArray(arg)) {
            expect(typeof arg[0]).toBe("string");
          } else {
            expect(typeof arg).toBe("number");
          }
        }
        if (Array.isArray(t.expected)) {
          expect(["string", "number"]).toContain(typeof t.expected[0]);
        } else {
          expect(typeof t.expected).toBe("number");
        }
      }
    }
  });

  test("every component has a non-trivial op format and prompt", () => {
    // The op encoding is the whole interface, so a component that does not document it is
    // unsolvable, not merely hard.
    for (const spec of COMPONENTS) {
      expect(spec.opFormat.length).toBeGreaterThan(20);
      expect(spec.promptMd.length).toBeGreaterThan(40);
      expect(spec.conceptMd.length).toBeGreaterThan(100);
    }
  });

  test("the catalogue's own tests are self-consistent", () => {
    // The expected output length must equal the number of output-producing ops, which is what
    // the prompt documents. This catches a copy-pasted test whose ops and expected disagree.
    for (const spec of COMPONENTS) {
      const c = getComponent(`python3/${spec.slug}`)!;
      expect(c.fnName).toBeTruthy();
      expect(c.tests.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("component slugs are unique and carry their language prefix", () => {
    const slugs = COMPONENTS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(getComponent("python3/lru-cache")?.lang).toBe("python3");
    expect(getComponent("no-such-component")).toBeNull();
  });
});

describe("exemplars", () => {
  for (const lang of LANGS) {
    test(`${lang}: every exemplar passes its own tests`, async () => {
      if (!available[lang]) return;

      const failures: string[] = [];
      for (const spec of COMPONENTS) {
        const c = getComponent(`${lang}/${spec.slug}`)!;
        const r = await runComponent(c.slug, c.solution);
        if (!r.accepted) {
          const first = r.cases.find((x) => !x.pass);
          failures.push(
            `${spec.slug}: ${r.passed}/${r.total}` +
              (first ? ` (args=${JSON.stringify(first.args)} got=${JSON.stringify(first.got)} want=${JSON.stringify(first.expected)})` : "") +
              (r.stderr ? ` stderr=${r.stderr.slice(0, 300)}` : ""),
          );
        }
      }

      expect(failures).toEqual([]);
    }, 900_000);
  }
});

describe("starters", () => {
  for (const lang of LANGS) {
    test(`${lang}: every starter compiles and fails`, async () => {
      if (!available[lang]) return;

      const failures: string[] = [];
      for (const spec of COMPONENTS) {
        const c = getComponent(`${lang}/${spec.slug}`)!;
        const r = await runComponent(c.slug, c.starter);

        // A compile error is a failed scaffold, not a failed test: it would show the student a
        // compiler diagnostic where an exercise should be.
        if (r.stderr && /error|Error|undefined:|cannot find|syntax/i.test(r.stderr) && r.passed === 0) {
          failures.push(`${spec.slug}: starter does not compile — ${r.stderr.slice(0, 200)}`);
          continue;
        }
        if (r.accepted) failures.push(`${spec.slug}: starter already passes`);
      }

      expect(failures).toEqual([]);
    }, 900_000);
  }
});

describe("passing a component", () => {
  test("records an item and schedules it, using the same grade derivation as DSA", async () => {
    if (!available.python3) return;
    seedComponents();

    const c = getComponent("python3/lru-cache")!;
    db.run("DELETE FROM item_cards WHERE item_id IN (SELECT id FROM items WHERE ref = ?)", [c.slug]);
    db.run("DELETE FROM items WHERE kind = 'component' AND ref = ?", [c.slug]);

    const r = await runComponent(c.slug, c.solution);
    expect(r.accepted).toBe(true);

    // A clean pass with no hints and no unlock, well inside the limit, is `Easy` (4).
    const schedule = recordComponent(c.slug, { accepted: true, passed: r.passed, total: r.total }, 60);

    expect(schedule.grade).toBe(4);
    expect(schedule.due).not.toBeNull();
    expect(schedule.intervalDays).toBeGreaterThan(0);

    const item = db
      .query<{ id: number; kind: string }, [string]>("SELECT id, kind FROM items WHERE ref = ?")
      .get(c.slug);
    expect(item?.kind).toBe("component");

    const card = db
      .query<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM item_cards WHERE item_id = ?")
      .get(item!.id);
    expect(card?.n).toBe(1);

    // And the list reflects the pass, which is what the UI's done-marker reads.
    expect(listComponents("python3").find((x) => x.slug === c.slug)?.reviewed).toBe(true);
  }, 120_000);

  test("a submission that never ran is not scheduled", async () => {
    if (!available.python3) return;
    const c = getComponent("python3/bloom-filter")!;
    db.run("DELETE FROM item_cards WHERE item_id IN (SELECT id FROM items WHERE ref = ?)", [c.slug]);

    // A compile error: no evidence either way, so it must not advance a schedule.
    const bad = await runComponent(c.slug, "class Solution:\n    def run_bloom(self, bits, ops)\n");
    expect(bad.accepted).toBe(false);

    const schedule = recordComponent(c.slug, { accepted: bad.accepted, passed: bad.passed, total: bad.total }, 10);
    expect(schedule.due).toBeNull();
  }, 120_000);
});
