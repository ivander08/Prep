/**
 * Pattern reference card tests.
 *
 * These assert the properties that would otherwise ship broken and are invisible in review: a
 * card that helps only Python, a duplicate key that hides another entry, an empty corner case
 * list. The `pattern` key is checked against the live database, because `getPatternRef` rests on
 * that string matching `problems.pattern` character for character. A rename in the ingest would
 * otherwise turn every card into a null.
 */

import { describe, expect, test } from "bun:test";
import { db } from "./db.ts";
import { PATTERN_REFS, getPatternRef } from "./reference/catalog.ts";
import { LANGS } from "./concepts.ts";

describe("pattern reference catalogue", () => {
  test("every pattern is unique", () => {
    const patterns = PATTERN_REFS.map((r) => r.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  test("every card has all five stdlib languages", () => {
    for (const r of PATTERN_REFS) {
      // Exactly the five keys, so a typo'd key cannot sit alongside the real one unnoticed.
      expect({ pattern: r.pattern, keys: Object.keys(r.stdlib).sort() }).toEqual({
        pattern: r.pattern,
        keys: [...LANGS].sort(),
      });
      for (const lang of LANGS) {
        expect({ pattern: r.pattern, lang, empty: r.stdlib[lang]!.length === 0 }).toEqual({
          pattern: r.pattern,
          lang,
          empty: false,
        });
      }
    }
  });

  test("every card carries complexity, corner cases and pitfalls", () => {
    for (const r of PATTERN_REFS) {
      expect({ pattern: r.pattern, empty: r.complexity.length === 0 }).toEqual({
        pattern: r.pattern,
        empty: false,
      });
      expect({ pattern: r.pattern, empty: r.cornerCases.length === 0 }).toEqual({
        pattern: r.pattern,
        empty: false,
      });
      expect({ pattern: r.pattern, empty: r.pitfalls.length === 0 }).toEqual({
        pattern: r.pattern,
        empty: false,
      });
    }
  });

  test("priority is one of the three bands", () => {
    for (const r of PATTERN_REFS) {
      expect(["High", "Mid", "Low"]).toContain(r.priority);
    }
  });

  test("every live pattern has a card", () => {
    const live = db
      .query<{ pattern: string }, []>("SELECT DISTINCT pattern FROM problems WHERE pattern IS NOT NULL")
      .all()
      .map((r) => r.pattern);

    // A checkout with no ingest has no patterns to check against; the tests above still ran.
    if (live.length === 0) return;

    expect(live.filter((p) => !getPatternRef(p))).toEqual([]);
  });

  test("getPatternRef returns null for a pattern with no card", () => {
    expect(getPatternRef("Nonexistent Pattern")).toBeNull();
  });
});
