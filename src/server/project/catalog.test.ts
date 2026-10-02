/**
 * The generation pipeline, driven by a stubbed model.
 *
 * Two things are worth pinning here that a live run would take 13 paid calls and several minutes to
 * show: that the curriculum's shape is what the UI and the grader rely on (ordered modules, 4-6
 * questions, all six study sections), and that regenerating a project whose files did not change
 * keeps the module rows — and therefore the graded sessions and review cards attached to them.
 *
 * The client is stubbed the way `tutor/regeneration.test.ts` stubs it: canned `submit_map` and
 * `submit_module` payloads, popped in order.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallMeta } from "../tutor/client.ts";

const meta = (): CallMeta => ({
  model: "stub",
  usage: { tokensIn: 10, tokensOut: 10, cachedTokens: 0 },
  cost: { idr: 0.5, tokensIn: 10, tokensOut: 10, cached: 0 },
  repaired: false,
  fellBackFrom: null,
});

let queue: unknown[] = [];
let calls = 0;

/** A queue entry that makes the stub throw, so failure paths are reachable without re-mocking. */
const THROW = Symbol("throw");

mock.module("../tutor/client.ts", () => ({
  chat: async () => ({ result: { content: "ok" }, meta: meta() }),
  // Runs the REAL validator, exactly as `structured` does. Without it the stub would accept
  // anything and the tests would assert nothing about the shapes the generator actually accepts.
  structured: async (
    _messages: unknown,
    _tool: unknown,
    validate: (v: unknown) => { ok: true; value: unknown } | { ok: false; missing: string[] },
  ) => {
    calls++;
    const next = queue.shift();
    if (next === undefined) throw new Error("stub exhausted");
    if (next === THROW) throw new Error("no API key: set KENARI_API_KEY in the environment");
    const check = validate(next);
    if (!check.ok) throw new Error(`stub payload rejected: ${check.missing.join(", ")}`);
    return { value: check.value, meta: meta() };
  },
  estimateCost: () => ({ idr: 0, tokensIn: 0, tokensOut: 0, cached: 0 }),
  KenariError: class extends Error {},
}));

const { db, migrate } = await import("../db.ts");
const { runGeneration, regenerateProject, startGeneration, REQUIRED_SECTIONS } = await import("./generate.ts");
const { getProject } = await import("../project.ts");

// The test preload copies the SCHEMA from the live database, which only knows the migrations that
// have been applied there. Running the migrator against the temp copy applies whatever is new
// (016 here) without touching `data/prep.db`.
migrate();

const dirs: string[] = [];

async function fixtureProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prep-gen-"));
  dirs.push(dir);
  await writeFile(join(dir, "index.ts"), "export function main() {\n  return 1;\n}\n");
  await writeFile(join(dir, "util.ts"), "export function helper() {\n  return 2;\n}\n");
  await writeFile(join(dir, "app.py"), "def run():\n    return 3\n");
  return dir;
}

/** A study document carrying every required section, so the validator accepts it. */
function study(title: string): string {
  return REQUIRED_SECTIONS.map((s) => `## ${s}\n\n${s} of ${title}. index.ts:1 shows it.`).join("\n\n");
}

function modulePayload(title: string) {
  return {
    title,
    studyMd: study(title),
    questions: [1, 2, 3, 4].map((n) => ({
      q: `${title} question ${n}?`,
      lookFor: ["a point", "another point"],
      commonMistakes: ["a mistake"],
    })),
  };
}

/** The two-module plan every case below uses; three modules are the validator's minimum. */
function plan() {
  return {
    stack: ["TypeScript", "Python"],
    modulePlan: [
      { title: "Entry points", objective: "Trace how the program starts.", files: ["index.ts", "util.ts"] },
      { title: "The Python side", objective: "Explain the Python entry point.", files: ["app.py", "index.ts"] },
      { title: "Putting it together", objective: "Explain the whole flow.", files: ["index.ts", "app.py"] },
    ],
  };
}

let projectId = 0;

beforeEach(() => {
  queue = [];
  calls = 0;
});

afterEach(async () => {
  if (projectId) {
    db.run("DELETE FROM item_cards WHERE item_id IN (SELECT id FROM items WHERE kind = 'project')");
    db.run("DELETE FROM items WHERE kind = 'project'");
    db.run("DELETE FROM projects WHERE id = ?", [projectId]);
    projectId = 0;
  }
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe("runGeneration", () => {
  test("writes ordered modules, each with 4-6 questions and all six study sections", async () => {
    const root = await fixtureProject();
    projectId = startGeneration({ root, name: "gen-fixture" });

    queue = [plan(), modulePayload("Entry points"), modulePayload("The Python side"), modulePayload("Putting it together")];
    await runGeneration(projectId);

    const detail = getProject(projectId);
    expect(detail).not.toBeNull();
    expect(detail!.project.status).toBe("ready");
    expect(detail!.project.modules).toBe(3);
    expect(detail!.stack).toEqual(["TypeScript", "Python"]);
    expect(detail!.scan?.fileCount).toBe(3);

    // Ordered by position, and the position is prefixed into the slug so the ref sorts the same way.
    expect(detail!.modules.map((m) => m.position)).toEqual([1, 2, 3]);
    expect(detail!.modules[0]!.slug).toBe("01-entry-points");
    expect(detail!.modules.map((m) => m.slug)).toEqual(["01-entry-points", "02-the-python-side", "03-putting-it-together"]);

    for (const m of detail!.modules) {
      expect(m.questions.length).toBeGreaterThanOrEqual(4);
      expect(m.questions.length).toBeLessThanOrEqual(6);
      for (const s of REQUIRED_SECTIONS) {
        expect(m.studyMd).toContain(`## ${s}`);
      }
    }
  });

  test("a path the model invented is dropped, and the module keeps the real ones", async () => {
    const root = await fixtureProject();
    projectId = startGeneration({ root, name: "gen-hallucination" });

    // `ghost.ts` does not exist. The module keeps index.ts + util.ts, so it survives.
    queue = [
      {
        stack: ["TypeScript"],
        modulePlan: [
          { title: "One", objective: "o", files: ["index.ts", "util.ts", "ghost.ts"] },
          { title: "Two", objective: "o", files: ["app.py", "index.ts"] },
          { title: "Three", objective: "o", files: ["util.ts", "app.py"] },
        ],
      },
      modulePayload("One"),
      modulePayload("Two"),
      modulePayload("Three"),
    ];
    await runGeneration(projectId);

    const detail = getProject(projectId);
    expect(detail!.modules[0]!.files).toEqual(["index.ts", "util.ts"]);
  });

  test("a plan that loses too many modules fails the run with the reason on the project", async () => {
    const root = await fixtureProject();
    projectId = startGeneration({ root, name: "gen-bad-plan" });

    // Every module references only nonexistent files, so none survives and the validator rejects it
    // twice (the stub is exhausted on the repair attempt).
    queue = [
      {
        stack: ["TypeScript"],
        modulePlan: [
          { title: "One", objective: "o", files: ["ghost-a.ts", "ghost-b.ts"] },
          { title: "Two", objective: "o", files: ["ghost-c.ts", "ghost-d.ts"] },
          { title: "Three", objective: "o", files: ["ghost-e.ts", "ghost-f.ts"] },
        ],
      },
    ];

    await runGeneration(projectId);

    const detail = getProject(projectId);
    expect(detail!.project.status).toBe("error");
    expect(detail!.project.error).toBeTruthy();
    expect(detail!.modules.length).toBe(0);
  });

  test("a missing API key is surfaced verbatim", async () => {
    const root = await fixtureProject();
    projectId = startGeneration({ root, name: "gen-nokey" });

    queue = [THROW];
    await runGeneration(projectId);

    const detail = getProject(projectId);
    expect(detail!.project.status).toBe("error");
    expect(detail!.project.error).toContain("no API key");
  });
  test("one malformed module is skipped, not fatal, and the rest of the run lands", async () => {
    const root = await fixtureProject();
    projectId = startGeneration({ root, name: "gen-partial" });

    // The second module comes back with no study document at all, which the validator rejects. The
    // other two must still be written and the project must end `ready`, with the skip named.
    queue = [
      plan(),
      modulePayload("Entry points"),
      { title: "The Python side", studyMd: "no sections here", questions: [] },
      modulePayload("Putting it together"),
    ];
    await runGeneration(projectId);

    const detail = getProject(projectId);
    expect(detail!.project.status).toBe("ready");
    expect(detail!.modules.length).toBe(2);
    expect(detail!.modules.map((m) => m.title)).toEqual(["Entry points", "Putting it together"]);
    expect(detail!.project.error).toContain("Skipped 1 module");
    expect(detail!.project.error).toContain("The Python side");
  });

  test("a module with more than six questions is trimmed rather than rejected", async () => {
    const root = await fixtureProject();
    projectId = startGeneration({ root, name: "gen-overflow" });

    const sevenQuestions = {
      title: "Entry points",
      studyMd: study("Entry points"),
      questions: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
        q: `Q${n}?`,
        lookFor: ["a", "b"],
        commonMistakes: ["m"],
      })),
    };
    queue = [plan(), sevenQuestions, modulePayload("The Python side"), modulePayload("Putting it together")];
    await runGeneration(projectId);

    const detail = getProject(projectId);
    expect(detail!.project.status).toBe("ready");
    expect(detail!.modules[0]!.questions.length).toBe(6);
  });
});

describe("regenerateProject", () => {
  test("keeps a module whose files did not change, and its review card", async () => {
    const root = await fixtureProject();
    projectId = startGeneration({ root, name: "gen-regen" });

    queue = [plan(), modulePayload("Entry points"), modulePayload("The Python side"), modulePayload("Putting it together")];
    await runGeneration(projectId);

    const before = getProject(projectId)!;
    const first = before.modules[0]!;

    // A review card, as `reviewProject` would write it, hung off the module's composite ref.
    const ref = `${before.project.slug}/${first.slug}`;
    db.run("INSERT INTO items (kind, ref, title, body_md) VALUES ('project', ?, ?, NULL)", [ref, first.title]);
    const itemId = db.query<{ id: number }, [string]>("SELECT id FROM items WHERE kind = 'project' AND ref = ?").get(ref)!.id;
    db.run("INSERT INTO item_cards (item_id, due, reps, lapses, state) VALUES (?, ?, 1, 0, 2)", [
      itemId,
      new Date().toISOString(),
    ]);

    // The same plan again: every module's file set is unchanged, so nothing should be regenerated
    // and no module row should be replaced.
    const beforeIds = before.modules.map((m) => m.id);
    queue = [plan(), modulePayload("Entry points"), modulePayload("The Python side"), modulePayload("Putting it together")];
    await regenerateProject(projectId);

    const after = getProject(projectId)!;
    expect(after.project.status).toBe("ready");
    expect(after.modules.map((m) => m.id)).toEqual(beforeIds);
    expect(after.modules[0]!.slug).toBe(first.slug);

    // The card survived: `learned` reads it back through the composite ref.
    expect(after.modules[0]!.learned).toBe(true);
    expect(
      db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM items WHERE kind = 'project' AND ref = ?").get(ref)!.n,
    ).toBe(1);
  });
});
