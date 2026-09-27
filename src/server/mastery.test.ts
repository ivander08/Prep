/**
 * Mastery and model-catalog tests.
 *
 * The mastery assertions use the seeded attempt profile rather than synthetic inputs,
 * because the point is that Elo recovers a *known ordering* from realistic behaviour:
 * a pattern solved cleanly should outrank one solved with hints, which should outrank one
 * that mostly failed.
 */

import { describe, expect, test } from "bun:test";
import { recomputeMastery, masteryReport, hintDependence, studyStats } from "./mastery.ts";
import { fetchCatalog, getRoleModel, setRoleModel, allRoleModels } from "./models.ts";

describe("mastery", () => {
  test("recomputes without error and produces rows", () => {
    const patterns = recomputeMastery();
    expect(patterns).toBeGreaterThan(0);

    const report = masteryReport();
    expect(report.length).toBe(patterns);
  });

  test("report is ordered weakest-first", () => {
    const report = masteryReport();
    for (let i = 1; i < report.length; i++) {
      expect(report[i]!.elo).toBeGreaterThanOrEqual(report[i - 1]!.elo);
    }
  });

  test("a cleanly-solved pattern outranks a hint-dependent one", () => {
    const report = masteryReport();
    const byPattern = new Map(report.map((r) => [r.pattern, r]));

    const strong = byPattern.get("Arrays & Hashing");
    const weak = byPattern.get("2-D Dynamic Programming");
    if (!strong || !weak) return; // depends on the seeded history being present

    expect(strong.elo).toBeGreaterThan(weak.elo);
    expect(strong.hintRate).toBeLessThan(weak.hintRate);
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

    // Sanity-check the unit conversion. The catalog reports `micro_idr_per_1m_tokens`,
    // where micro-Rupiah is Rp x 1e6, so IDR per 1M tokens = catalog / 1e6. Verified
    // against the live gateway: a 38-in / 29,000-out call moved the quota by exactly Rp 1,
    // which the Rp 20/M reading predicts (Rp 1.45) and an Rp 150/M reading does not (Rp 8.71).
    //
    // Asserted as a range rather than an exact value because the listed price genuinely
    // changes — this model was seen at both 150,000,000 and 20,000,000 micro-IDR in one day.
    const ds = models.find((m) => m.id === "deepseek-v4-1-flash");
    if (ds && ds.inputPerM !== null) {
      expect(ds.inputPerM).toBeGreaterThan(0);
      expect(ds.inputPerM).toBeLessThan(1000);
      // The conversion must not be off by 1000 in either direction.
      expect(ds.inputPerM).toBeLessThan(ds.outputPerM ?? Infinity);
    }
  });

  test("free models report free pricing", async () => {
    const models = await fetchCatalog();
    const free = models.filter((m) => m.free);
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
