/**
 * The daily streak.
 *
 * A day counts when a CARD WAS SCHEDULED on it. That is the union of `cards.last_review` (a
 * graded DSA attempt) and `item_cards.last_review` (a concept, component, pattern, or design
 * round), so the streak rewards graded work of any kind rather than only LeetCode solves.
 *
 * Derived, not tracked. There is no `streak` column and no per-day activity table: a counter
 * would have to be incremented on every path that schedules a card, and every one of those
 * paths is a place it could be missed or double-counted. Reading the two `last_review` columns
 * cannot drift, because they are the same writes the scheduler already makes.
 *
 * Days are LOCAL, not UTC. `date(x,'localtime')` is load-bearing: 2026-09-28T17:30:00.000Z is
 * the 28th in UTC and the 29th in WIB, so a UTC bucket would credit the wrong day for every
 * evening session.
 */

import { db } from "./db.ts";

export type StreakDay = {
  /** `YYYY-MM-DD`, local. */
  day: string;
  /** Graded events on that day. Drives the heatmap's intensity, not just its on/off. */
  count: number;
};

export type StreakStats = {
  /** Consecutive active days ending today or yesterday. 0 when the chain is already broken. */
  current: number;
  /** The longest consecutive run ever recorded. */
  best: number;
  todayDone: boolean;
  /**
   * The heatmap's data: every day in the window, oldest first, INCLUDING days with no activity
   * (as `count: 0`). Zero days are sent rather than inferred so the client does no date
   * arithmetic — it chunks the array into weeks and renders.
   *
   * The window is a whole number of Monday-aligned weeks ending with the current week, so the
   * first element is always a Monday and the last is always a Sunday.
   */
  calendar: StreakDay[];
  /** Total distinct days with a graded event. */
  activeDays: number;
};

/** 52 weeks — a full year, the span every contribution graph is read against. */
const WEEKS = 52;

/** `YYYY-MM-DD` in local time. `toISOString` would be UTC and would shift the evening. */
function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Days since epoch for a `YYYY-MM-DD` string. Parsed as UTC deliberately: these are labels. */
function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86400000;
}

/** The `YYYY-MM-DD` label for a day number. */
function dayFromNumber(n: number): string {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

/** The `YYYY-MM-DD` label `n` days before `day`. */
function dayMinus(day: string, n: number): string {
  return dayFromNumber(dayNumber(day) - n);
}

/** Monday = 0 … Sunday = 6. 1970-01-01 was a Thursday, which is why the offset is 3. */
function weekdayOf(day: string): number {
  return (dayNumber(day) + 3) % 7;
}

/**
 * Pure day-walk over `YYYY-MM-DD` strings, newest first. Exported so the streak arithmetic is
 * testable without a database — the SQL is a two-line union and the arithmetic is the part
 * that can be wrong.
 *
 * A streak stays alive through *yesterday*: at 09:00 you have not done today's work yet, and
 * showing "0 day streak" every morning would be both wrong and discouraging. It breaks only
 * once a full day has been skipped.
 */
export function streakFrom(days: string[], today: string): { current: number; best: number } {
  if (days.length === 0) return { current: 0, best: 0 };

  const set = new Set(days);
  const nums = [...set].map(dayNumber).sort((a, b) => a - b);

  let best = 1;
  let run = 1;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === nums[i - 1]! + 1) run++;
    else run = 1;
    if (run > best) best = run;
  }

  // Start at today, or at yesterday when today is not done yet. Anything older is a break.
  let cursor = set.has(today) ? today : dayMinus(today, 1);

  let current = 0;
  while (set.has(cursor)) {
    current++;
    cursor = dayMinus(cursor, 1);
  }

  return { current, best };
}

/** Each local day with a graded event, and how many, newest first. */
function dayCounts(): StreakDay[] {
  return db
    .query<StreakDay, []>(
      `SELECT day, COUNT(*) AS count FROM (
         SELECT date(last_review, 'localtime') AS day FROM cards      WHERE last_review IS NOT NULL
         UNION ALL
         SELECT date(last_review, 'localtime') AS day FROM item_cards WHERE last_review IS NOT NULL
       )
       GROUP BY day
       ORDER BY day DESC`,
    )
    .all();
}

export function streakStats(now = new Date()): StreakStats {
  const rows = dayCounts();
  const days = rows.map((r) => r.day);
  const today = localDay(now);
  const { current, best } = streakFrom(days, today);

  const counts = new Map(rows.map((r) => [r.day, r.count]));
  const set = new Set(days);

  // Monday-aligned weeks ending with the current week: the last column is the week in progress,
  // so the grid does not shift under the reader every time a new week starts.
  const end = dayNumber(today) + (6 - weekdayOf(today));
  const start = end - (WEEKS * 7 - 1);

  const calendar: StreakDay[] = [];
  for (let n = start; n <= end; n++) {
    const day = dayFromNumber(n);
    calendar.push({ day, count: counts.get(day) ?? 0 });
  }

  return {
    current,
    best,
    todayDone: set.has(today),
    calendar,
    activeDays: set.size,
  };
}
