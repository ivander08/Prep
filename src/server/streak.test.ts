/**
 * Streak arithmetic tests.
 *
 * `streakFrom` is the pure part of the streak: a day walk over `YYYY-MM-DD` strings with no
 * database. It is tested directly because the arithmetic is what can be wrong. The SQL is a
 * two-line union, and the local-vs-UTC day bucket is a property of `date(x,'localtime')` that
 * the end-to-end check covers instead.
 *
 * The cases that matter are the boundaries: a run ending yesterday is still alive, a run ending
 * two days ago is not, and `best` comes from the longer side of a gap.
 */

import { describe, expect, test } from "bun:test";
import { streakFrom } from "./streak.ts";

const TODAY = "2026-09-28";

describe("streakFrom", () => {
  test("empty history is zero, not a throw", () => {
    expect(streakFrom([], TODAY)).toEqual({ current: 0, best: 0 });
  });

  test("today only", () => {
    expect(streakFrom([TODAY], TODAY)).toEqual({ current: 1, best: 1 });
  });

  test("a run ending today counts through the whole run", () => {
    const days = ["2026-09-28", "2026-09-27", "2026-09-26"];
    expect(streakFrom(days, TODAY)).toEqual({ current: 3, best: 3 });
  });

  test("a run ending yesterday is still alive", () => {
    // At 09:00 you have not done today's work yet. Showing 0 every morning would be wrong.
    const days = ["2026-09-27", "2026-09-26", "2026-09-25"];
    expect(streakFrom(days, TODAY)).toEqual({ current: 3, best: 3 });
  });

  test("a run ending two days ago has broken", () => {
    const days = ["2026-09-26", "2026-09-25"];
    expect(streakFrom(days, TODAY)).toEqual({ current: 0, best: 2 });
  });

  test("best comes from the longer side of a gap", () => {
    const days = ["2026-09-28", "2026-09-27", "2026-09-20", "2026-09-19", "2026-09-18"];
    expect(streakFrom(days, TODAY)).toEqual({ current: 2, best: 3 });
  });

  test("a single day sets best to 1", () => {
    expect(streakFrom(["2026-09-01"], TODAY)).toEqual({ current: 0, best: 1 });
  });

  test("a run spanning a month boundary is contiguous", () => {
    const days = ["2026-10-02", "2026-10-01", "2026-09-30", "2026-09-29"];
    expect(streakFrom(days, "2026-10-02")).toEqual({ current: 4, best: 4 });
  });

  test("a run spanning a year boundary is contiguous", () => {
    const days = ["2027-01-02", "2027-01-01", "2026-12-31"];
    expect(streakFrom(days, "2027-01-02")).toEqual({ current: 3, best: 3 });
  });
});
