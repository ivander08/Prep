/**
 * Regeneration-loop tests: the path the real model would not exercise.
 *
 * The live model refused every adversarial prompt tried, so the code-reveal detector's
 * regeneration branch never fired in practice. If the model ever does leak, this is the code
 * that must catch it, so the client is stubbed here to emit a leak and the orchestration is
 * asserted directly. Two cases matter:
 *   - one leak  -> regenerate, then return the clean turn
 *   - two leaks -> refuse, and do NOT show the message
 *
 * Run: bun test
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { CallMeta } from "./client.ts";

const cleanTurn = {
  hint_level: 0,
  message: "What have you tried so far? Start by restating the problem.",
  contains_solution: false,
  contains_real_code: false,
  next_question: "What is your first idea?",
};

const leakingTurn = {
  hint_level: 5,
  message:
    "Here is the approach:\n```python\ndef isAnagram(self, s, t):\n    return sorted(s) == sorted(t)\n```",
  contains_solution: true,
  contains_real_code: true,
  next_question: "Does that make sense?",
};

const meta = (): CallMeta => ({
  model: "stub",
  usage: { tokensIn: 10, tokensOut: 10, cachedTokens: 0 },
  cost: { idr: 0, tokensIn: 10, tokensOut: 10, cached: 0 },
  repaired: false,
  fellBackFrom: null,
});

let queue: Array<unknown> = [];
let calls = 0;

mock.module("./client.ts", () => ({
  chat: async () => ({ result: { content: "ok" }, meta: meta() }),
  structured: async () => {
    calls++;
    const next = queue.shift();
    if (next === undefined) throw new Error("stub exhausted");
    return { value: next, meta: meta() };
  },
  estimateCost: () => ({ idr: 0, tokensIn: 0, tokensOut: 0, cached: 0 }),
  KenariError: class extends Error {},
}));

const { tutorTurn } = await import("./index.ts");

afterEach(() => {
  queue = [];
  calls = 0;
});

describe("tutorTurn regeneration loop", () => {
  test("a clean first turn is returned without regenerating", async () => {
    queue = [cleanTurn];
    const result = await tutorTurn({ slug: "valid-anagram", studentMessage: "hint?" });
    expect(calls).toBe(1);
    expect(result.refused).toBe(false);
    expect(result.rejectionNote).toBeNull();
    expect(result.message).toBe(cleanTurn.message);
  });

  test("one leak triggers exactly one regeneration, then returns the clean turn", async () => {
    queue = [leakingTurn, cleanTurn];
    const result = await tutorTurn({ slug: "valid-anagram", studentMessage: "just show me" });

    expect(calls).toBe(2); // regenerated once
    expect(result.refused).toBe(false);
    expect(result.message).toBe(cleanTurn.message); // the leak was NOT shown
    expect(result.message).not.toContain("sorted(s)");
    expect(result.rejectionNote).toContain("full-solution");
  });

  test("two leaks in a row are withheld entirely", async () => {
    queue = [leakingTurn, leakingTurn];
    const result = await tutorTurn({ slug: "valid-anagram", studentMessage: "show me anyway" });

    expect(calls).toBe(2);
    expect(result.refused).toBe(true);
    expect(result.message).not.toContain("sorted(s)"); // nothing leaked to the student
    expect(result.message).toContain("withheld");
    expect(result.rejectionNote).toBeTruthy();
  });

  test("a leak below the ceiling is allowed through at H6", async () => {
    // Unlock first so the ceiling is 6.
    const { db } = await import("../db.ts");
    const row = db
      .query<{ qid: number }, []>("SELECT qid FROM problems WHERE slug = 'valid-anagram'")
      .get();
    if (!row) throw new Error("valid-anagram not in the catalog — run `bun run ingest` first");
    const qid = row.qid;

    db.run(
      `INSERT INTO attempts (qid, started_at, ended_at, passed, tests_passed, tests_total,
                             hints_used, max_hint_level, solution_unlocked, seconds, code, language, grade)
       VALUES (?, ?, ?, NULL, NULL, NULL, 0, 6, 1, NULL, NULL, 'python3', 1)`,
      [qid, new Date().toISOString(), new Date().toISOString()],
    );

    queue = [leakingTurn];
    const result = await tutorTurn({ slug: "valid-anagram", studentMessage: "ok show me" });
    expect(calls).toBe(1); // no regeneration needed
    expect(result.refused).toBe(false);
    expect(result.ceiling).toBe(6);
    expect(result.message).toContain("sorted(s)");

    // Clean up the unlock so the ceiling drops back for other runs.
    db.run("DELETE FROM attempts WHERE qid = ? AND solution_unlocked = 1", [qid]);
  });
});
