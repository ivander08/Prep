/**
 * Resource resolution that works both from source and from a `bun build --compile` binary.
 *
 * The problem, measured rather than assumed: under compile, `import.meta.dir` becomes
 * `B:\~BUN\root`, a virtual path inside the executable. `readdirSync(join(import.meta.dir,
 * "migrations"))` throws `ENOENT ... scandir 'B:\~BUN\root\migrations'`, `Bun.file` on the same
 * path fails the same way, and `new Bun.Glob(...).scan(import.meta.dir)` returns 0 entries.
 * There is no embedded-asset escape hatch that makes those reads work.
 *
 * So the compiled binary reads its resources from a directory NEXT TO ITSELF, which the build
 * ships. That is the whole fix: one helper, used by every resource read in the server, so a new
 * read cannot accidentally reintroduce the bug.
 *
 *   dev:       <repo>/src/server/{migrations,harnesses}   and   <repo>/dist/ui
 *   compiled:  <dir of the executable>/resources/{migrations,harnesses,ui}
 *
 * `PREP_RESOURCES` overrides the compiled root and `PREP_UI_DIR` overrides the UI directory, so
 * a test or a Tauri build can point elsewhere without a rebuild.
 */

import { join, dirname } from "node:path";

/**
 * True when running inside a compiled executable.
 *
 * `Bun.isStandaloneExecutable` is the predicate that actually means this. It matters that the
 * answer is right on every platform: the previous check was `import.meta.dir.includes("~BUN")`,
 * which matches Windows' `B:\~BUN\root` but not Linux/macOS's `/$bunfs/root`. There the check was
 * false, `RESOURCE_ROOT` became the virtual root, and `readdirSync(MIGRATIONS_DIR)` threw ENOENT —
 * so migrations never applied and the app came up against an empty schema.
 *
 * The `~BUN` substring stays as a fallback for a runtime old enough to lack the predicate.
 */
export const IS_COMPILED: boolean =
  typeof Bun.isStandaloneExecutable === "boolean"
    ? Bun.isStandaloneExecutable
    : import.meta.dir.includes("~BUN");

/**
 * Where the resources live.
 *
 * In dev this is `src/server`, which is exactly what `import.meta.dir` already was — so the
 * source-mode behaviour is unchanged and every existing relative read still resolves.
 */
export const RESOURCE_ROOT = IS_COMPILED
  ? (process.env.PREP_RESOURCES ?? join(dirname(process.execPath), "resources"))
  : import.meta.dir;

/** A path under `RESOURCE_ROOT`. */
export function resourcePath(...parts: string[]): string {
  return join(RESOURCE_ROOT, ...parts);
}

/**
 * The built UI directory.
 *
 * Not under `RESOURCE_ROOT` in dev: Vite writes to `dist/ui` at the repo root, which is two
 * levels up from `src/server`. In a compiled build the UI is shipped inside `resources/`, so it
 * is one level down from there.
 */
export const UI_DIR =
  process.env.PREP_UI_DIR ??
  (IS_COMPILED ? join(RESOURCE_ROOT, "ui") : join(import.meta.dir, "../../dist/ui"));
