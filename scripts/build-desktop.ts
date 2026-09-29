/**
 * Build the standalone server: compile the API to a single executable and lay out the resource
 * directory it reads from.
 *
 * Why a directory rather than embedding. Under `bun build --compile`, `import.meta.dir` becomes
 * `B:\~BUN\root` — a virtual path inside the executable — so `readdirSync` on it throws
 * `ENOENT`, `Bun.file` fails the same way, and `Bun.Glob(...).scan` returns zero entries.
 * Measured, not assumed. `src/server/paths.ts` therefore resolves every resource from
 * `dirname(process.execPath)/resources` when compiled, and this script is what puts them there.
 *
 * Output, under `dist/desktop/`:
 *
 *   prep-server.exe                       the compiled API (measured ~82 MB)
 *   prep-server-<target-triple>.exe       the same binary under the name Tauri's `externalBin`
 *                                         requires: it appends the target triple itself and
 *                                         fails the build if the suffixed file is missing
 *   resources/migrations/                 the SQL migrations, applied on boot
 *   resources/harnesses/                  the Java / C++ / Python harness templates
 *   resources/ui/                         the built UI, served by the same process
 *
 * `data/prep.db` is created beside the executable on first run, not shipped: it is the user's
 * own progress.
 *
 * Run: `bun run build:desktop`
 */

import { rmSync, mkdirSync, cpSync, existsSync, statSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "dist/desktop");
const RESOURCES = join(OUT, "resources");

/**
 * The host target triple, read from rustc rather than hardcoded.
 *
 * Tauri's `externalBin` resolves `prep-server` to `prep-server-<triple>.exe`, and a mismatch is
 * a build failure with a message about a missing binary. Asking rustc means the two agree by
 * construction, including on an ARM host.
 *
 * rustup installs to `~/.cargo/bin` and only adds that to PATH in a NEW shell, so a build run in
 * the same terminal as the install would not see it. The fallback matters for that case.
 */
function targetTriple(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const candidates = [
    "rustc",
    join(home, ".cargo", "bin", process.platform === "win32" ? "rustc.exe" : "rustc"),
  ];

  for (const exe of candidates) {
    // `Bun.spawnSync` THROWS on ENOENT rather than returning a non-zero exit code, so a missing
    // candidate has to be caught rather than checked. Without this the first absent entry aborts
    // the whole build with a raw "Executable not found in $PATH".
    let host = "";
    try {
      const out = Bun.spawnSync([exe, "-vV"], { stdout: "pipe", stderr: "pipe" });
      if (out.exitCode !== 0) continue;
      host = out.stdout.toString();
    } catch {
      continue;
    }
    const line = host.split("\n").find((l) => l.startsWith("host: "));
    if (line) return line.slice("host: ".length).trim();
  }

  throw new Error(
    "rustc not found. Install the Rust toolchain (https://rustup.rs) before building the desktop app.",
  );
}

function sizeOf(path: string): string {
  const bytes = statSync(path).size;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// The UI must exist first: this script ships it, and a missing one would produce a server that
// answers the API and 404s the app, which is the two-terminal problem in a new costume.
if (!existsSync(join(ROOT, "dist/ui/index.html"))) {
  console.log("[desktop] dist/ui is missing — running the UI build first");
  const build = Bun.spawnSync(["bun", "run", "build:ui"], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (build.exitCode !== 0) throw new Error("build:ui failed");
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(RESOURCES, { recursive: true });

console.log("[desktop] compiling the server");
const compile = Bun.spawnSync(
  ["bun", "build", "--compile", "src/server/index.ts", "--outfile", join(OUT, "prep-server.exe")],
  { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
);
if (compile.exitCode !== 0) throw new Error("bun build --compile failed");

console.log("[desktop] copying resources");
cpSync(join(ROOT, "src/server/migrations"), join(RESOURCES, "migrations"), { recursive: true });
cpSync(join(ROOT, "src/server/harnesses"), join(RESOURCES, "harnesses"), { recursive: true });
cpSync(join(ROOT, "dist/ui"), join(RESOURCES, "ui"), { recursive: true });

const serverExe = join(OUT, "prep-server.exe");
const triple = targetTriple();
const suffixed = join(OUT, `prep-server-${triple}.exe`);
copyFileSync(serverExe, suffixed);

console.log(`[desktop] ${serverExe} — ${sizeOf(serverExe)}`);
console.log(`[desktop] ${suffixed} — the name \`bundle.externalBin\` resolves`);
console.log(`[desktop] resources beside it: ${RESOURCES}`);
