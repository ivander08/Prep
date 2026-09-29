/**
 * Mastery and model-catalog tests.
 *
 * These seed their own attempt history instead of depending on whatever happens to be in the
 * database. An earlier version asserted against data a different test had left behind, which
 * coupled the tests and meant the seed landed in the user's real database.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { db, migrate } from "./db.ts";
import { recomputeMastery, masteryReport, hintDependence, studyStats } from "./mastery.ts";
import { fetchCatalog, getRoleModel, setRoleModel, allRoleModels } from "./models.ts";

/**
 * Seed a known attempt profile: one pattern solved cleanly, one solved mostly with hints.
 * The assertions below describe the *relationship* between those two, so the seed defines
 * the expected ordering.
 */
beforeAll(() => {
  migrate();

  db.run("DELETE FROM attempts");

  const rows = db
    .query<{ qid: number; pattern: string }, []>(
      `SELECT qid, pattern FROM problems
       WHERE pattern IS NOT NULL AND paid_only = 0
       ORDER BY qid LIMIT 400`,
    )
    .all();

  const byPattern = new Map<string, number[]>();
  for (const r of rows) {
    const list = byPattern.get(r.pattern) ?? [];
    list.push(r.qid);
    byPattern.set(r.pattern, list);
  }

  const now = new Date().toISOString();
  const insert = db.query(
    `INSERT INTO attempts (qid, started_at, ended_at, passed, tests_passed, tests_total,
                           hints_used, max_hint_level, solution_unlocked, seconds, code, language, grade)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 600.0, '', 'python3', ?)`,
  );

  db.transaction(() => {
    // "Arrays & Hashing" is solved cleanly; everything else is solved with hints.
    for (const [pattern, qids] of byPattern) {
      const clean = pattern === "Arrays & Hashing";
      for (const qid of qids.slice(0, 6)) {
        const passed = clean ? 1 : 0;
        const hints = clean ? 0 : 2;
        insert.run(qid, now, now, passed, passed ? 3 : 1, 3, hints, hints, passed ? 4 : 1);
      }
    }
  })();

  recomputeMastery();
});

describe("mastery", () => {
  test("produces rows after seeding", () => {
    const report = masteryReport();
    expect(report.length).toBeGreaterThan(0);
  });

  test("report is ordered weakest-first", () => {
    const report = masteryReport();
    for (let i = 1; i < report.length; i++) {
      expect(report[i]!.elo).toBeGreaterThanOrEqual(report[i - 1]!.elo);
    }
  });

  test("a cleanly-solved pattern outranks a hint-dependent one", () => {
    const byPattern = new Map(masteryReport().map((r) => [r.pattern, r]));

    const clean = byPattern.get("Arrays & Hashing");
    const hinted = [...byPattern.values()].find((r) => r.pattern !== "Arrays & Hashing" && r.attempts > 0);
    if (!clean || !hinted) throw new Error("seed did not produce the expected patterns");

    expect(clean.elo).toBeGreaterThan(hinted.elo);
    expect(clean.hintRate).toBe(0);
    expect(hinted.hintRate).toBeGreaterThan(0);
  });

  test("hint rate is a fraction, not a count", () => {
    for (const row of hintDependence()) {
      expect(row.hintRate).toBeGreaterThanOrEqual(0);
      expect(row.hintRate).toBeLessThanOrEqual(1);
      expect(row.attemptsWithHints).toBeLessThanOrEqual(row.totalAttempts);
    }
  });

  test("stats are internally consistent", () => {
    const s = studyStats();
    expect(s.unaided + s.withHints).toBeLessThanOrEqual(s.attempts);
    expect(s.totalTutorCost).toBeGreaterThanOrEqual(0);
  });
});

describe("model catalog", () => {
  test("fetches models with prices converted from micro-IDR to IDR per 1M tokens", async () => {
    const models = await fetchCatalog();
    expect(models.length).toBeGreaterThan(50);

    // The catalog reports `micro_idr_per_1m_tokens`, where micro-Rupiah is Rp x 1e6, so
    // IDR per 1M tokens = catalog / 1e6. Verified against the live gateway: a
    // 38-in / 29,000-out call moved the quota by Rp 1, which the Rp 20/M reading
    // predicts (Rp 1.45) and an Rp 150/M reading does not (Rp 8.71).
    //
    // Asserted as a range, not a single value, because the listed price changes: this model was
    // seen at both 150,000,000 and 20,000,000 micro-IDR in one day.
    const ds = models.find((m) => m.id === "deepseek-v4-1-flash");
    if (ds && ds.inputPerM !== null) {
      expect(ds.inputPerM).toBeGreaterThan(0);
      expect(ds.inputPerM).toBeLessThan(1000);
      // The conversion must not be off by 1000 in either direction.
      expect(ds.inputPerM).toBeLessThan(ds.outputPerM ?? Infinity);
    }
  });

  test("free models report free pricing", async () => {
    const free = (await fetchCatalog()).filter((m) => m.free);
    expect(free.length).toBeGreaterThan(0);
  });

  test("role assignment round-trips and clears", () => {
    const before = getRoleModel("tutor");
    try {
      setRoleModel("tutor", "glm-5-3-flash");
      expect(getRoleModel("tutor")).toBe("glm-5-3-flash");
      expect(allRoleModels().tutor).toBe("glm-5-3-flash");
    } finally {
      setRoleModel("tutor", before);
    }
    expect(getRoleModel("tutor")).toBe(before);
  });
});
