/**
 * Fill the DESKTOP app's database with the catalog and the test suites.
 *
 * The desktop build does not share the repo's `data/prep.db`. The Tauri shell points the sidecar
 * at the OS app-data directory, because an installed app cannot write next to itself in
 * Program Files — so a fresh install starts with an empty database and an empty catalog. That is
 * correct for progress (it belongs to the user) and wrong for the catalog, which is fetched data
 * the user should not have to re-fetch by hand.
 *
 * This runs the same three ingests the repo uses, with `PREP_DB_PATH` pointed at the app's
 * database. Every ingest already honours that variable, so nothing here duplicates fetch logic.
 *
 * The directory must match `app_data_dir()` in `src-tauri/src/main.rs`; Tauri derives it from the
 * bundle identifier in `tauri.conf.json`, which is why the identifier is read from there rather
 * than repeated.
 *
 * Run: `bun run ingest:desktop`
 */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const ROOT = join(import.meta.dir, "..");

/** The bundle identifier, read from the Tauri config so the two cannot disagree. */
function identifier(): string {
  const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8")) as {
    identifier?: string;
  };
  if (!conf.identifier) throw new Error("tauri.conf.json has no `identifier`");
  return conf.identifier;
}

/**
 * Tauri's app-data directory per platform.
 *
 * Windows is the only target this project builds, but the other two are three lines and make the
 * script fail with the right path rather than a confusing one if a target is ever added.
 */
function appDataDir(): string {
  const id = identifier();
  if (process.platform === "win32") {
    const roaming = process.env.APPDATA;
    if (!roaming) throw new Error("APPDATA is not set");
    return join(roaming, id);
  }
  if (process.platform === "darwin") {
    return join(process.env.HOME ?? "", "Library", "Application Support", id);
  }
  return join(process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? "", ".local", "share"), id);
}

const dir = appDataDir();
const dbPath = join(dir, "prep.db");

if (!existsSync(dir)) {
  throw new Error(
    `No desktop app data at ${dir}.\n` +
      `Run the desktop app once (bunx tauri dev, or the installed app) so it creates its database, then re-run this.`,
  );
}

console.log(`[desktop] target database: ${dbPath}`);

// The three ingests, in the order the README documents them. Each is a separate process because
// they are separate entry points that already set up their own database handles.
const steps = [
  { label: "catalog + curated lists", script: "src/server/ingest.ts" },
  { label: "full test suites", script: "src/server/fulltests.ts" },
  { label: "SQL 50 statements and seed data", script: "src/server/sql/ingest.ts" },
];

for (const step of steps) {
  console.log(`\n[desktop] ${step.label}`);
  const run = Bun.spawnSync(["bun", "run", step.script], {
    cwd: ROOT,
    env: { ...process.env, PREP_DB_PATH: dbPath },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (run.exitCode !== 0) {
    throw new Error(`${step.script} failed with exit code ${run.exitCode}`);
  }
}

console.log(`\n[desktop] done. The app reads ${dbPath}`);
