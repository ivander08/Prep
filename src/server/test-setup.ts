/**
 * Test setup — point the database at a throwaway file.
 *
 * This exists because tests were previously writing to the real `data/prep.db`. Seeded
 * attempt history from a mastery test showed up as the user's own progress, which is both
 * confusing and a genuine data-integrity bug: a test run should never mutate the thing it
 * is testing.
 *
 * Imported first by every test file that touches the database.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.PREP_DB_PATH) {
  const dir = mkdtempSync(join(tmpdir(), "prep-test-"));
  process.env.PREP_DB_PATH = join(dir, "test.db");
}

export const TEST_DB_PATH = process.env.PREP_DB_PATH;
