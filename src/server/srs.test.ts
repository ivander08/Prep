/**
 * SRS acceptance fixtures — BUILD-SPEC §5.2 and §5.3.
 *
 * The interval-cap test is the important one: ts-fsrs defaults to a 36,500-day cap, and
 * an uncapped scheduler silently stops showing you problems you still need. That failure
 * is invisible in a demo and only shows up weeks later.
 */

import { describe, expect, test } from "bun:test";
import { Rating, createEmptyCard } from "ts-fsrs";
import { SCHEDULER, gradeAttempt } from "./srs.ts";

describe("gradeAttempt — behaviour, never self-report", () => {
  const base = { passed: true, hintsUsed: 0, solutionUnlocked: false, seconds: 300 };

  test("failed attempt is Again", () => {
    expect(gradeAttempt({ ...base, passed: false })).toBe(Rating.Again);
  });

  test("unlocking the solution is Again even if tests passed", () => {
    expect(gradeAttempt({ ...base, solutionUnlocked: true })).toBe(Rating.Again);
  });

  test("passing after a hint is Hard, not Easy", () => {
    expect(gradeAttempt({ ...base, hintsUsed: 2 })).toBe(Rating.Hard);
  });

  test("passing unaided but slowly is Good", () => {
    expect(gradeAttempt({ ...base, seconds: 30 * 60, limitSeconds: 20 * 60 })).toBe(Rating.Good);
  });

  test("passing unaided and fast is Easy", () => {
    expect(gradeAttempt({ ...base, seconds: 60, limitSeconds: 20 * 60 })).toBe(Rating.Easy);
  });

  test("hints dominate speed — a fast solve with a hint is still Hard", () => {
    expect(gradeAttempt({ ...base, hintsUsed: 1, seconds: 5, limitSeconds: 20 * 60 })).toBe(Rating.Hard);
  });
});

describe("SCHEDULER configuration", () => {
  const now = new Date("2026-09-27T09:00:00Z");

  test("first-encounter intervals are sane for a sprint", () => {
    const card = createEmptyCard(now);
    const days = (g: Exclude<Rating, Rating.Manual>): number =>
      SCHEDULER.repeat(card, now)[g].card.scheduled_days;

    expect(days(Rating.Again)).toBe(1);
    expect(days(Rating.Hard)).toBe(2);
    expect(days(Rating.Good)).toBe(4);
    // Easy is 17 d here vs 8 d under ts-fsrs defaults — lowering request_retention to
    // 0.85 lengthens every interval. That is the intended trade for a short horizon.
    expect(days(Rating.Easy)).toBe(17);
  });

  test("intervals stay bounded — the cap holds over 30 reviews", () => {
    let card = createEmptyCard(now);
    let at = new Date(now);
    let max = 0;

    for (let i = 0; i < 30; i++) {
      card = SCHEDULER.repeat(card, at)[Rating.Good].card;
      at = new Date(card.due);
      max = Math.max(max, card.scheduled_days);
    }

    // Uncapped, this reaches 8,346 days. The cap is "≈90": fuzz is applied AFTER the
    // cap, so a small overshoot is expected and correct. Asserting <= 90 would be wrong.
    expect(max).toBeLessThanOrEqual(95);
    expect(max).toBeGreaterThan(60);
  });

  test("a lapse collapses stability and increments lapses", () => {
    let card = createEmptyCard(now);
    let at = new Date(now);
    for (let i = 0; i < 5; i++) {
      card = SCHEDULER.repeat(card, at)[Rating.Good].card;
      at = new Date(card.due);
    }
    const before = card.scheduled_days;

    const lapsed = SCHEDULER.repeat(card, at)[Rating.Again].card;
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.scheduled_days).toBeLessThan(before);
    expect(lapsed.scheduled_days).toBeGreaterThan(0);
  });
});
