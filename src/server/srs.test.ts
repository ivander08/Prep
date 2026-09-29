/**
 * SRS acceptance fixtures: BUILD-SPEC §5.2 and §5.3.
 *
 * The interval-cap test is the important one: ts-fsrs defaults to a 36,500-day cap, and
 * an uncapped scheduler stops showing you problems you still need, with no error raised.
 * That failure is invisible in a demo and only shows up weeks later.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Rating, createEmptyCard } from "ts-fsrs";
import { SCHEDULER, gradeAttempt, dueItems } from "./srs.ts";
import { db } from "./db.ts";

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
    // Easy is 17 d here vs 8 d under ts-fsrs defaults: lowering request_retention to
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

    // Uncapped, this reaches 8,346 days. The cap is "≈90": fuzz is applied after the
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

/**
 * The regression this exists for: `items.kind` takes six values, and the three readers that
 * preceded `dueItems` each pinned one kind. A concept, a component or a design prompt was
 * scheduled, written to `item_cards`, and never read back. The due date went in and nothing
 * came out. Every seeded row below would have been invisible to the old readers.
 */
describe("dueItems — every scheduled kind is readable", () => {
  const PAST = new Date(Date.now() - 86_400_000).toISOString();
  const FUTURE = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const KINDS = ["pattern", "concept", "component", "design", "behavioral", "stack"] as const;

  /** The `items` + `item_cards` pair `ensureKindItem` writes, minus the scheduler. */
  function seed(kind: string, ref: string, due: string, title = `${kind} ${ref}`): void {
    db.run("INSERT INTO items (kind, ref, title, body_md) VALUES (?, ?, ?, NULL)", [kind, ref, title]);
    const id = db.query<{ id: number }, [string, string]>("SELECT id FROM items WHERE kind = ? AND ref = ?").get(kind, ref)!.id;
    db.run("INSERT INTO item_cards (item_id, due, reps, lapses, state) VALUES (?, ?, 1, 0, 2)", [id, due]);
  }

  function unseed(kind: string, ref: string): void {
    db.run("DELETE FROM item_cards WHERE item_id IN (SELECT id FROM items WHERE kind = ? AND ref = ?)", [kind, ref]);
    db.run("DELETE FROM items WHERE kind = ? AND ref = ?", [kind, ref]);
  }

  const seeded: Array<[string, string]> = [];

  function add(kind: string, ref: string, due: string, title?: string): void {
    seed(kind, ref, due, title);
    seeded.push([kind, ref]);
  }

  afterEach(() => {
    for (const [kind, ref] of seeded) unseed(kind, ref);
    seeded.length = 0;
  });

  test("every non-DSA kind comes back", () => {
    for (const kind of KINDS) add(kind, `srs-test-${kind}`, PAST);

    const kinds = new Set(dueItems(200).map((d) => d.kind));
    for (const kind of KINDS) expect(kinds).toContain(kind);
  });

  test("a future-dated row is excluded", () => {
    add("concept", "srs-test-future", FUTURE, "future concept");
    add("concept", "srs-test-due", PAST);

    const titles = dueItems(200).map((d) => d.title);
    expect(titles).toContain("concept srs-test-due");
    expect(titles).not.toContain("future concept");
  });

  test("oldest due first, across both tables", () => {
    // Distinct timestamps, one per row, so the ORDER BY is actually exercised.
    add("concept", "srs-test-oldest", new Date(Date.now() - 3 * 86_400_000).toISOString());
    add("component", "srs-test-middle", new Date(Date.now() - 2 * 86_400_000).toISOString());
    add("design", "srs-test-newest", PAST);

    const order = dueItems(200)
      .filter((d) => d.ref.startsWith("srs-test-"))
      .map((d) => d.ref);
    expect(order).toEqual(["srs-test-oldest", "srs-test-middle", "srs-test-newest"]);
  });

  test("an unknown kind is returned rather than dropped", () => {
    // `items.kind` has no CHECK constraint, so a track added later must not need a code change
    // here to become visible. That is how three kinds ended up with no reader.
    add("sql", "srs-test-unknown", PAST);

    expect(dueItems(200).some((d) => (d.kind as string) === "sql")).toBe(true);
  });

  test("a DSA card appears in the same list as the item rows", () => {
    add("concept", "srs-test-with-dsa", PAST);
    db.run(
      `INSERT INTO cards (qid, due, reps, lapses, state, suspended)
       VALUES (?, ?, 2, 0, 2, 0)
       ON CONFLICT(qid) DO UPDATE SET due = excluded.due, suspended = 0`,
      [1, PAST],
    );

    try {
      const rows = dueItems(200);
      const dsa = rows.find((d) => d.kind === "dsa");
      expect(dsa?.ref).toBe("two-sum");
      expect(dsa?.problemSlug).toBeNull();
      expect(rows.map((d) => d.ref)).toContain("srs-test-with-dsa");
    } finally {
      db.run("DELETE FROM cards WHERE qid = 1");
    }
  });

  test("a suspended DSA card is not due", () => {
    db.run(
      `INSERT INTO cards (qid, due, reps, lapses, state, suspended)
       VALUES (?, ?, 2, 0, 2, 1)
       ON CONFLICT(qid) DO UPDATE SET due = excluded.due, suspended = 1`,
      [1, PAST],
    );

    try {
      expect(dueItems(200).some((d) => d.kind === "dsa")).toBe(false);
    } finally {
      db.run("DELETE FROM cards WHERE qid = 1");
    }
  });

  test("a pattern row carries the most recently passed problem, and a pattern with none carries null", () => {
    // Synthetic problems under a pattern name no other fixture writes, because the shared
    // catalog's real problems carry attempts left by `mastery.test.ts`. Asserting against
    // those would make this pass or fail on file ordering, not on `dueItems`.
    const pattern = "SRS Test Pattern";
    const OLDER = 900_001;
    const NEWER = 900_002;
    const FAILED = 900_003;
    add("pattern", pattern, PAST);

    db.run("INSERT INTO problems (qid, slug, title, difficulty, pattern) VALUES (?, ?, ?, 'Medium', ?)", [OLDER, "srs-test-older", "Older problem", pattern]);
    db.run("INSERT INTO problems (qid, slug, title, difficulty, pattern) VALUES (?, ?, ?, 'Medium', ?)", [NEWER, "srs-test-newer", "Newer problem", pattern]);
    db.run("INSERT INTO problems (qid, slug, title, difficulty, pattern) VALUES (?, ?, ?, 'Medium', ?)", [FAILED, "srs-test-failed", "Failed problem", pattern]);

    const insert = (qid: number, passed: number, endedAt: string): void => {
      db.run(
        `INSERT INTO attempts (qid, started_at, ended_at, passed, hints_used, language)
         VALUES (?, ?, ?, ?, 0, 'python3')`,
        [qid, endedAt, endedAt, passed],
      );
    };
    // The failure is dated latest, so "most recent" has to mean most recent pass, not most
    // recent attempt. A query that forgot `passed = 1` would pick it.
    insert(OLDER, 1, "2026-01-01T00:00:00.000Z");
    insert(NEWER, 1, "2026-02-01T00:00:00.000Z");
    insert(FAILED, 0, "2026-03-01T00:00:00.000Z");

    try {
      const row = dueItems(200).find((d) => d.ref === pattern);
      expect(row?.problemSlug).toBe("srs-test-newer");
    } finally {
      db.run("DELETE FROM attempts WHERE qid IN (?, ?, ?)", [OLDER, NEWER, FAILED]);
      db.run("DELETE FROM problems WHERE qid IN (?, ?, ?)", [OLDER, NEWER, FAILED]);
    }

    // A pattern nothing has passed stays in the list with a null `problemSlug`. It is still
    // scheduled, it just has nothing to re-solve.
    const orphan = "SRS Test Orphan Pattern";
    add("pattern", orphan, PAST);
    const orphanRow = dueItems(200).find((d) => d.ref === orphan);
    expect(orphanRow?.problemSlug).toBeNull();
  });
});

