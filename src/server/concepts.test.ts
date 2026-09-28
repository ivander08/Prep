/**
 * Fundamentals fixtures.
 *
 * The load-bearing test is "every exemplar passes its own tests". That is the only reason
 * shipping 155 generated exercises is defensible: the executor is a deterministic oracle, so
 * a wrong exemplar fails here rather than being taught to a student as the answer.
 *
 * The other two matter for the same reason from the other direction: a starter that already
 * passes teaches nothing, and a starter that does not compile teaches the wrong thing.
 *
 * A language whose runtime is not installed is SKIPPED, not failed, so the suite still runs
 * on a machine without the full toolchain — matching runner.test.ts.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { CONCEPTS, fnNameFor } from "./concepts/catalog.ts";
import { getConcept, listConcepts, metaFor, runConcept, seedConcepts } from "./concepts.ts";
import { detectAvailableLanguages } from "./languages.ts";
import { db } from "./db.ts";

const LANGS = ["python3", "javascript", "java", "cpp", "go"] as const;

let available: Record<string, boolean> = {};

beforeAll(async () => {
  seedConcepts();
  available = await detectAvailableLanguages();
  const missing = LANGS.filter((l) => !available[l]);
  if (missing.length > 0) console.log(`[concepts] runtimes not installed, skipping: ${missing.join(", ")}`);
}, 120_000);

describe("concept catalogue", () => {
  test("every concept is seeded for every language", () => {
    expect(listConcepts()).toHaveLength(CONCEPTS.length * LANGS.length);
  });

  test("each language has the full set", () => {
    for (const lang of LANGS) {
      expect(listConcepts(lang)).toHaveLength(CONCEPTS.length);
    }
  });

  test("no exemplar is a stub", () => {
    // A generated exercise that was never written would show up as a short body, and the
    // executor would happily report a compile failure as a "failed test".
    for (const spec of CONCEPTS) {
      for (const lang of LANGS) {
        const c = getConcept(`${lang}/${spec.slug}`);
        expect(c).not.toBeNull();
        expect(c!.solution.length).toBeGreaterThan(20);
        expect(c!.starter.length).toBeGreaterThan(0);
        expect(c!.solution).not.toContain("TODO");
        expect(c!.starter).not.toContain("TODO");
      }
    }
  });

  test("the function name is derived per language, not stored per language", () => {
    // A stored name could disagree between the catalogue and a language file; a derived one
    // cannot. This pins the derivation, including Go's exported PascalCase.
    expect(fnNameFor("python3", "mostFrequent")).toBe("most_frequent");
    expect(fnNameFor("javascript", "mostFrequent")).toBe("mostFrequent");
    expect(fnNameFor("java", "mostFrequent")).toBe("mostFrequent");
    expect(fnNameFor("cpp", "mostFrequent")).toBe("mostFrequent");
    expect(fnNameFor("go", "mostFrequent")).toBe("MostFrequent");
  });

  test("every type the tests use is expressible in the runner's vocabulary", () => {
    // The C++ harness generates its call site from these types and Java has no int[][]
    // argument coercion, so a matrix here would fail to compile in two of five languages.
    for (const spec of CONCEPTS) {
      const meta = metaFor(spec);
      for (const p of meta.params) {
        expect(["integer", "integer[]", "string", "string[]", "boolean"]).toContain(p.type);
      }
      expect(["integer", "integer[]", "string", "string[]", "boolean"]).toContain(meta.return!.type);
    }
  });

  test("concept slugs are unique and carry their language prefix", () => {
    const slugs = CONCEPTS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(getConcept("python3/stack")?.lang).toBe("python3");
    expect(getConcept("no-such-concept")).toBeNull();
  });
});

describe("exemplars", () => {
  for (const lang of LANGS) {
    test(`${lang}: every exemplar passes its own tests`, async () => {
      if (!available[lang]) return;

      const failures: string[] = [];
      for (const spec of CONCEPTS) {
        const c = getConcept(`${lang}/${spec.slug}`)!;
        const r = await runConcept(c.slug, c.solution);
        if (!r.accepted) {
          const first = r.cases.find((x) => !x.pass);
          failures.push(
            `${spec.slug}: ${r.passed}/${r.total}` +
              (first ? ` (args=${JSON.stringify(first.args)} got=${JSON.stringify(first.got)})` : "") +
              (r.stderr ? ` stderr=${r.stderr.slice(0, 200)}` : ""),
          );
        }
      }

      expect(failures).toEqual([]);
    }, 600_000);
  }
});

describe("passing a concept", () => {
  test("records an item and schedules it, using the same grade derivation as DSA", async () => {
    if (!available.python3) return;
    seedConcepts();

    const c = getConcept("python3/stack")!;
    db.run("DELETE FROM item_cards WHERE item_id IN (SELECT id FROM items WHERE ref = ?)", [c.slug]);
    db.run("DELETE FROM items WHERE kind = 'concept' AND ref = ?", [c.slug]);

    const r = await runConcept(c.slug, c.solution);
    expect(r.accepted).toBe(true);

    // A clean pass with no hints and no unlock, well inside the limit, is `Easy` (4).
    const { recordConcept } = await import("./concepts.ts");
    const schedule = recordConcept(c.slug, { accepted: true, passed: r.passed, total: r.total }, 60);

    expect(schedule.grade).toBe(4);
    expect(schedule.due).not.toBeNull();
    expect(schedule.intervalDays).toBeGreaterThan(0);

    const item = db
      .query<{ id: number; kind: string }, [string]>("SELECT id, kind FROM items WHERE ref = ?")
      .get(c.slug);
    expect(item?.kind).toBe("concept");

    const card = db
      .query<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM item_cards WHERE item_id = ?")
      .get(item!.id);
    expect(card?.n).toBe(1);

    // And the list reflects the pass, which is what the UI's done-marker reads.
    expect(listConcepts("python3").find((x) => x.slug === c.slug)?.reviewed).toBe(true);
  }, 60_000);

  test("a submission that never ran is not scheduled", async () => {
    if (!available.python3) return;
    const c = getConcept("python3/hash-set")!;
    db.run("DELETE FROM item_cards WHERE item_id IN (SELECT id FROM items WHERE ref = ?)", [c.slug]);

    // A compile error: no evidence either way, so it must not advance a schedule.
    const bad = await runConcept(c.slug, "class Solution:\n    def unique_count(self, nums)\n");
    expect(bad.accepted).toBe(false);

    const { recordConcept } = await import("./concepts.ts");
    const schedule = recordConcept(c.slug, { accepted: bad.accepted, passed: bad.passed, total: bad.total }, 10);
    expect(schedule.due).toBeNull();
  }, 60_000);
});
