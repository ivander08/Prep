/**
 * Build a throwaway database with plausible progress, for README screenshots.
 *
 * The real `data/prep.db` holds the catalog and nothing else, and it must stay that way: seeding
 * demo attempts into it would show up as the user's own solved count, which is the exact bug
 * `test-preload.ts` exists to prevent. So this copies the catalog into a temp file and writes the
 * fake history there, then prints the path for `PREP_DB_PATH`.
 *
 * The history is shaped to make each surface non-empty rather than to be statistically pretty:
 * a 12-week arc for the progress bars, a mix of grades so mastery has spread, a few items due
 * now so the review queue and its kind filter have something to filter, and enough unaided
 * passes to earn the early milestones.
 *
 * Run: `bun run scripts/demo-db.ts`
 */

import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dir, "..");
const REAL = join(ROOT, "data/prep.db");
const OUT_DIR = join(tmpdir(), "prep-demo");
const OUT = join(OUT_DIR, "demo.db");

if (!existsSync(REAL)) throw new Error(`no catalog at ${REAL} — run \`bun run ingest\` first`);

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
copyFileSync(REAL, OUT);
// A stale WAL beside the copy would be replayed on open and can resurrect rows this script
// deletes, so the sidecar files are removed rather than copied.
for (const suffix of ["-wal", "-shm"]) rmSync(OUT + suffix, { force: true });

const db = new Database(OUT);

/** `YYYY-MM-DD` for a day offset from today. */
function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** An ISO timestamp `offset` days ago, at a plausible working hour. */
function at(offset: number, hour = 20): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
}

// Wipe anything user-owned so the result is deterministic.
for (const t of ["tutor_turns", "attempts", "cards", "item_cards", "pattern_mastery", "milestones", "design_sessions", "track_sessions"]) {
  db.run(`DELETE FROM ${t}`);
}
db.run("DELETE FROM items WHERE kind <> 'concept'");

// A realistic arc: sparse at the start, a heavy middle, lighter recently.
const weeks: Array<{ start: number; perWeek: number }> = [
  { start: -77, perWeek: 4 },
  { start: -70, perWeek: 6 },
  { start: -63, perWeek: 5 },
  { start: -56, perWeek: 9 },
  { start: -49, perWeek: 11 },
  { start: -42, perWeek: 8 },
  { start: -35, perWeek: 12 },
  { start: -28, perWeek: 10 },
  { start: -21, perWeek: 13 },
  { start: -14, perWeek: 9 },
  { start: -7, perWeek: 7 },
  { start: 0, perWeek: 5 },
];

const problems = db
  .query<{ qid: number; slug: string; title: string; difficulty: string; pattern: string | null }, []>(
    `SELECT qid, slug, title, difficulty, pattern FROM problems
     WHERE pattern IS NOT NULL ORDER BY qid LIMIT 400`,
  )
  .all();

if (problems.length === 0) throw new Error("no problems with a pattern — run `bun run ingest` first");

let cursor = 0;
const solved = new Set<number>();
let attempts = 0;

const insertAttempt = db.query(
  `INSERT INTO attempts (qid, started_at, ended_at, passed, tests_passed, tests_total,
                         hints_used, max_hint_level, solution_unlocked, seconds, code, language, grade)
   VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, '', 'python3', ?)`,
);

for (const week of weeks) {
  for (let i = 0; i < week.perWeek; i++) {
    const p = problems[cursor % problems.length]!;
    cursor++;
    const offset = week.start + (i % 6);
    const clean = solved.has(p.qid);
    const hints = clean || i % 5 === 0 ? 0 : 1;
    const passed = clean || i % 7 !== 0;
    const seconds = passed ? 240 + (i % 9) * 95 : 900 + (i % 5) * 200;
    // The same derivation the app uses: fail → 1, hints → 2, slow clean → 3, fast clean → 4.
    const grade = !passed ? 1 : hints > 0 ? 2 : seconds > 1200 ? 3 : 4;
    insertAttempt.run(p.qid, at(offset, 19 + (i % 3)), at(offset, 20 + (i % 3)), passed ? 1 : 0, passed ? 1 : 0, 1, hints, seconds, grade);
    if (passed) solved.add(p.qid);
    attempts++;
  }
}

// Today and yesterday, so the streak reads as live rather than as a lapsed run. Without these the
// last seeded day can fall a few days back, and a hero screenshot showing "streak 0" beside a lit
// heatmap looks like a bug in the thing being screenshotted.
for (const offset of [-1, 0]) {
  const p = problems[cursor++ % problems.length]!;
  insertAttempt.run(p.qid, at(offset, 9), at(offset, 10), 1, 1, 1, 0, 640, 4);
  solved.add(p.qid);
  attempts++;
}

const solvedList = [...solved];

// DSA cards.
//
// `last_review` is what the streak AND the heatmap read — not `attempts.ended_at` — so the dates
// here are what make the calendar and the streak live. They are spread across the same twelve
// weeks the attempts cover, with the most recent two landing on today and yesterday, so the
// readout shows a current streak rather than a lapsed one.
const insertCard = db.query(
  `INSERT INTO cards (qid, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review)
   VALUES (?, ?, 12.5, 5.2, 3, 8, ?, ?, 2, ?)
   ON CONFLICT(qid) DO UPDATE SET due = excluded.due, reps = excluded.reps, lapses = excluded.lapses,
                                 last_review = excluded.last_review`,
);

// Four cards due now, so the queue is short enough that every kind is represented within the
// 40-row cap. Each last reviewed between yesterday and four days back.
//
// Drawn from the FRONT of the solved list; the heatmap history below draws from the back, so the
// two sets are disjoint and neither loop's `ON CONFLICT` clause clobbers the other's due date.
const dueNow = solvedList.slice(0, 4);
dueNow.forEach((qid, i) => {
  insertCard.run(qid, at(-(i % 3) - 1, 9), 2 + (i % 3), i === 2 ? 1 : 0, at(-1 - i, 20));
});

// The heatmap's history: a card reviewed on each day the attempts arc covers, so the calendar is
// lit for the same span the progress bars show.
//
// These are due 30 days from TODAY, not 30 days from the review date: the review date spans
// twelve weeks back, so adding to it would leave the old weeks due in the past and refill the
// queue, hiding every non-DSA kind behind the 40-row cap.
const historyDays: number[] = [];
for (const week of weeks) {
  for (let i = 0; i < Math.min(week.perWeek, 6); i++) historyDays.push(week.start + i);
}
historyDays.push(-1, 0);

const historyPool = solvedList.slice(4);
historyDays.forEach((offset, i) => {
  const qid = historyPool[(i * 7 + 11) % historyPool.length]!;
  insertCard.run(qid, at(30, 8), 1 + (i % 4), i % 9 === 0 ? 1 : 0, at(offset, 20));
});

// Non-DSA cards: a pattern, a concept, a component, a design round, a SQL problem, and a
// behavioral prompt, so the review queue's kind filter has more than one chip to offer.
const items: Array<{ kind: string; ref: string; title: string; due: number; reps: number }> = [
  { kind: "pattern", ref: "Arrays & Hashing", title: "Arrays & Hashing", due: -1, reps: 3 },
  { kind: "concept", ref: "python3/dynamic-array", title: "Dynamic array", due: 0, reps: 2 },
  { kind: "component", ref: "python3/lru-cache", title: "LRU cache", due: -2, reps: 1 },
  { kind: "design", ref: "rate-limiter", title: "Design a rate limiter", due: 0, reps: 2 },
  { kind: "behavioral", ref: "ownership-of-a-failure", title: "A failure you owned", due: -1, reps: 1 },
  { kind: "sql", ref: "department-top-three-salaries", title: "Department Top Three Salaries", due: 0, reps: 1 },
  { kind: "sql", ref: "recyclable-and-low-fat-products", title: "Recyclable and Low Fat Products", due: -3, reps: 4 },
];

const insertItem = db.query(
  `INSERT INTO items (kind, ref, title) VALUES (?, ?, ?) ON CONFLICT(kind, ref) DO UPDATE SET title = excluded.title`,
);
const insertItemCard = db.query(
  `INSERT INTO item_cards (item_id, due, stability, difficulty, reps, lapses, state, last_review)
   VALUES (?, ?, 11.0, 5.0, ?, ?, 2, ?)
   ON CONFLICT(item_id) DO UPDATE SET due = excluded.due, reps = excluded.reps`,
);
for (const it of items) {
  insertItem.run(it.kind, it.ref, it.title);
  const id = db.query<{ id: number }, [string, string]>("SELECT id FROM items WHERE kind = ? AND ref = ?").get(it.kind, it.ref)!.id;
  insertItemCard.run(id, at(it.due, 10), it.reps, it.kind === "pattern" ? 1 : 0, at(it.due - 6, 10));
}

// Mastery, so the weakness view has a spread rather than one flat number.
const patterns = [...new Set(problems.map((p) => p.pattern).filter(Boolean))] as string[];
const elos = [1180, 1245, 1302, 1355, 1418, 1466, 1523, 1271, 1338, 1391, 1447, 1502, 1223, 1288, 1364, 1431, 1495, 1551, 1612];
const insertMastery = db.query(
  `INSERT INTO pattern_mastery (pattern, elo, attempts, solved, updated_at, hint_rate, lapses)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
patterns.forEach((pattern, i) => {
  const elo = elos[i % elos.length]!;
  insertMastery.run(pattern, elo, 12 + (i % 17), 6 + (i % 11), new Date().toISOString(), (i % 5) * 0.06, i % 4);
});

// A finished design round, so the design track shows a graded session.
const finished = patterns[0]!;
db.run(
  `INSERT INTO design_sessions (slug, started_at, ended_at, drafts, transcript, probe_level, seconds, scores, grade, model, cost_idr)
   VALUES (?, ?, ?, '{}', '[]', 4, 2400, '{}', 3, 'demo', 812.5)`,
  [finished.toLowerCase().replace(/[^a-z0-9]+/g, "-"), at(-4, 21), at(-4, 22)],
);

const counts = db
  .query<{ attempts: number; cards: number; itemCards: number; solved: number }, []>(
    `SELECT (SELECT COUNT(*) FROM attempts) AS attempts,
            (SELECT COUNT(*) FROM cards) AS cards,
            (SELECT COUNT(*) FROM item_cards) AS itemCards,
            (SELECT COUNT(DISTINCT qid) FROM attempts WHERE passed = 1) AS solved`,
  )
  .get()!;

db.close();

console.log(`[demo] ${OUT}`);
console.log(`[demo] ${counts.attempts} attempts, ${counts.solved} distinct solved, ${counts.cards} cards, ${counts.itemCards} non-DSA cards`);
console.log(`[demo] run the server with:\n  PREP_DB_PATH="${OUT}" bun run src/server/index.ts`);
console.log(`[demo] attempts seeded: ${attempts}`);
