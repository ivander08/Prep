/**
 * Bun test preload: isolates every test run from the real database.
 *
 * Without this, a test that seeds attempt history writes it into `data/prep.db` and it shows up
 * as the user's own progress. That happened: 112 seeded attempts appeared as the user's solved
 * count. A test run must never mutate the thing it is testing.
 *
 * The catalog tables ARE copied, because tests legitimately need reference data (problem slugs,
 * patterns, lists). Only the user-owned tables are left empty.
 *
 * Registered via `preload` in bunfig.toml so it runs before any test module imports db.ts.
 */

import { Database } from "bun:sqlite";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REAL_DB = join(import.meta.dir, "../../data/prep.db");
const TEST_DB = join(mkdtempSync(join(tmpdir(), "prep-test-")), "test.db");

process.env.PREP_DB_PATH = TEST_DB;

if (existsSync(REAL_DB)) {
  // Reference data only. Attempts, cards, tutor_turns, and pattern_mastery are user-owned
  // and must start empty so assertions describe a known state.
  //
  // `meta` IS copied because it records which migrations have run. Without it the copied
  // schema (already post-migration) would be re-migrated, and `ALTER TABLE ADD COLUMN`
  // would fail with "duplicate column name".
  const CATALOG_TABLES = ["problems", "lists", "company_problems", "meta"];

  const source = new Database(REAL_DB, { readonly: true });
  const dest = new Database(TEST_DB, { create: true });

  try {
    const schema = source
      .query<{ sql: string | null }, []>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL",
      )
      .all();

    for (const row of schema) {
      if (row.sql) dest.run(row.sql);
    }

    const indexRows = source
      .query<{ sql: string | null }, []>(
        "SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL",
      )
      .all();
    for (const row of indexRows) {
      if (row.sql) {
        try {
          dest.run(row.sql);
        } catch {
          // Index already implied by a copied table definition.
        }
      }
    }

    for (const table of CATALOG_TABLES) {
      const exists = source
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .get(table);
      if (!exists || exists.n === 0) continue;

      const rows = source.query<Record<string, unknown>, []>(`SELECT * FROM ${table}`).all();
      if (rows.length === 0) continue;

      const cols = Object.keys(rows[0]!);
      const placeholders = cols.map(() => "?").join(", ");
      const insert = dest.query(
        `INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`,
      );

      dest.transaction(() => {
        for (const r of rows) insert.run(...(cols.map((c) => r[c]) as never[]));
      })();
    }
  } finally {
    source.close();
    dest.close();
  }
}
