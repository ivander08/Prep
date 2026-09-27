import { Database } from "bun:sqlite";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * The database path is overridable via PREP_DB_PATH so tests never touch the real one.
 * Tests that write to the live database are a bug: they corrupt the user's progress and
 * make their counts meaningless.
 */
const DB_PATH = process.env.PREP_DB_PATH ?? join(import.meta.dir, "../../data/prep.db");
const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true });

// WAL: concurrent reads while the UI polls. Foreign keys: the schema relies on them.
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

/**
 * Apply every migration in filename order, once. Tracked in `meta.schema_version`
 * so re-running is a no-op. Migrations are plain SQL and must be idempotent
 * (CREATE TABLE IF NOT EXISTS) — this runner deliberately does not do rollbacks.
 */
export function migrate(): void {
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");

  const applied = new Set(
    db
      .query<{ key: string }, []>("SELECT key FROM meta WHERE key LIKE 'migration:%'")
      .all()
      .map((r) => r.key),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    const key = `migration:${file}`;
    if (applied.has(key)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.run("INSERT INTO meta (key, value) VALUES (?, ?)", [key, new Date().toISOString()]);
    })();
    ran++;
  }

  if (ran > 0) console.log(`[db] applied ${ran} migration(s)`);
}

export function getMeta(key: string): string | null {
  const row = db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key);
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db.run(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

if (import.meta.main) {
  migrate();
  const counts = db
    .query<{ table: string; n: number }, []>(
      `SELECT 'problems' AS table, COUNT(*) AS n FROM problems
       UNION ALL SELECT 'lists', COUNT(*) FROM lists
       UNION ALL SELECT 'cards', COUNT(*) FROM cards
       UNION ALL SELECT 'attempts', COUNT(*) FROM attempts`,
    )
    .all();
  console.log(`[db] ${DB_PATH}`);
  for (const c of counts) console.log(`  ${c.table.padEnd(10)} ${c.n}`);
}
