// Phase 4 readouts, against a throwaway copy. Never the real database.
import { Database } from "bun:sqlite";
import { copyFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DIR = join(tmpdir(), "prep-p4");
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const COPY = join(DIR, "p4.db");
copyFileSync("data/prep.db", COPY);
process.env.PREP_DB_PATH = COPY;

const { evaluateMilestones } = await import("./src/server/milestones.ts");
const { streakStats } = await import("./src/server/streak.ts");
const { recomputeMastery, masteryReport } = await import("./src/server/mastery.ts");
const db = new Database(COPY);
const find = (id: string) => evaluateMilestones().find((m) => m.id === id)!;

console.log("=== 4.5 every-pattern-attempted on an empty log ===");
console.log("  ", find("every-pattern-attempted").progress, "(want 0/18)");

console.log("\n=== 4.1 ten-components: one component in 5 languages + one other ===");
// The real ref format is `${lang}/${slug}`, as components.ts writes it.
const insItem = db.query("INSERT INTO items (kind, ref, title) VALUES ('component', ?, ?)");
const insCard = db.query("INSERT INTO item_cards (item_id, due, stability, difficulty, reps, lapses, state) VALUES (?, '2026-01-01', 1, 5, 1, 0, 2)");
for (const lang of ["python3", "javascript", "java", "cpp", "go"]) insCard.run(insItem.run(`${lang}/fixed-window`, "Fixed window").lastInsertRowid);
insCard.run(insItem.run("python3/rate-limiter", "Rate limiter").lastInsertRowid);
console.log("   reads", find("ten-components").progress, "(want 2/10, not 6/10)");

console.log("\n=== 4.2 no-lapses-month: an unlock row, no failed attempt ===");
const qid = db.query<{ qid: number }, []>("SELECT qid FROM problems LIMIT 1").get()!.qid;
const now = new Date().toISOString();
// Exactly the shape index.ts writes on a solution unlock: grade 1, passed NULL.
db.run(`INSERT INTO attempts (qid, started_at, ended_at, passed, hints_used, max_hint_level, solution_unlocked, seconds, code, language, grade)
        VALUES (?, ?, ?, NULL, 0, 4, 1, 600, '', 'python3', 1)`, [qid, now, now]);
const nl = find("no-lapses-month");
console.log("   ", nl.progress, "-> lapses must be 0");

console.log("\n=== 4.6 activeDays inside the 52-week grid ===");
const insCard2 = db.query("INSERT INTO cards (qid, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review) VALUES (?, '2026-12-01', 1, 5, 0, 1, 1, 0, 2, ?)");
// One recent day inside the window, one far outside it.
insCard2.run(qid, now);
const old = new Date(Date.now() - 500 * 86400000).toISOString();
const qid2 = db.query<{ qid: number }, []>("SELECT qid FROM problems LIMIT 1 OFFSET 1").get()!.qid;
insCard2.run(qid2, old);
const s = streakStats();
const filled = s.calendar.filter((d) => d.count > 0).length;
console.log("   activeDays =", s.activeDays, "| filled cells =", filled, "| cells =", s.calendar.length);
console.log("   (the 500-day-old review is outside the grid, so activeDays must be 1, not 2)");

console.log("\n=== 4.4 Elo uses seconds (boundary GRADE_LIMIT_SECONDS = 1200) ===");
for (const [label, secs] of [["fast 300", 300], ["slow 1300", 1300]] as const) {
  db.run("DELETE FROM attempts");
  db.run(`INSERT INTO attempts (qid, started_at, ended_at, passed, hints_used, max_hint_level, solution_unlocked, seconds, code, language, grade)
          VALUES (?, '2026-01-01T00:00:00Z', '2026-01-01T00:20:00Z', 1, 0, 0, 0, ?, '', 'python3', 4)`, [qid, secs]);
  recomputeMastery();
  console.log("   ", label.padEnd(9), "-> elo", Math.round(masteryReport()[0]?.elo ?? 0));
}

console.log("\n=== 4.7 window is 30 days inclusive ===");
console.log("   ", nl.progress);

db.close();
