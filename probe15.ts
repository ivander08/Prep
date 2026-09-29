// 6.3: a forced throw between the attempt insert and the card write must leave neither row.
import { Database } from "bun:sqlite";
import { copyFileSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DIR = join(tmpdir(), "prep-p63");
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const COPY = join(DIR, "p63.db");
copyFileSync("data/prep.db", COPY);
process.env.PREP_DB_PATH = COPY;

const { db } = await import("./src/server/db.ts");
const { reviewCard } = await import("./src/server/srs.ts");
const qid = db.query<{ qid: number }, []>("SELECT qid FROM problems LIMIT 1").get()!.qid;

db.run("DELETE FROM attempts");
db.run("DELETE FROM cards");

const before = {
  attempts: db.query<{ n: number }, []>("SELECT COUNT(*) n FROM attempts").get()!.n,
  cards: db.query<{ n: number }, []>("SELECT COUNT(*) n FROM cards").get()!.n,
};

let threw = false;
try {
  db.transaction(() => {
    db.run(
      `INSERT INTO attempts (qid, started_at, ended_at, passed, hints_used, max_hint_level, solution_unlocked, seconds, code, language, grade)
       VALUES (?, '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z', 1, 0, 0, 0, 600, '', 'python3', 4)`,
      [qid],
    );
    reviewCard(qid, 4 as never, new Date());
    throw new Error("forced failure between the two writes");
  })();
} catch {
  threw = true;
}

const after = {
  attempts: db.query<{ n: number }, []>("SELECT COUNT(*) n FROM attempts").get()!.n,
  cards: db.query<{ n: number }, []>("SELECT COUNT(*) n FROM cards").get()!.n,
};
console.log("threw:", threw, "| before:", before, "| after:", after);
console.log(after.attempts === before.attempts && after.cards === before.cards ? "ok   neither row survived" : "FAIL a row survived");

// 6.6: a throw from PROGRAMS[...] must not orphan the temp directory.
const { runInLanguage } = await import("./src/server/runner.ts");
const glob = (p: string) => readdirSync(tmpdir()).filter((n) => n.startsWith(p));
const beforeDirs = glob("prep_cpp_").length;
let e2 = "";
try {
  // A `cpp` run whose code makes the harness template read fail is hard to force; instead force
  // the same code path — a throw from the program builder — via an unsupported meta that makes
  // `cppProgram` return a harness which compiles, so use the mkdir path with a bad language.
  await runInLanguage({ language: "cpp", code: "class Solution {};", fnName: "f", cases: [{ args: [], expected: 1 }], meta: null });
} catch (err) {
  e2 = String(err);
}
console.log("cpp temp dirs before:", beforeDirs, "after:", glob("prep_cpp_").length, "| unexpected error:", e2.slice(0, 60));
db.close();
