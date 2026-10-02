/**
 * Compiling LaTeX with the machine's own TeX distribution.
 *
 * The engine is probed at runtime rather than bundled, matching the app's local-first rule and the
 * contract `detectAvailableLanguages()` already uses: `Bun.spawn` THROWS when the binary is
 * missing, and that throw is the detection. Nothing here resolves a path — `pdflatex`,
 * `pdftotext`, `pdffonts` and `pdfinfo` are spawned by bare name, the way `runner.ts` spawns
 * `python`, `node`, `java`, `go` and `g++`, so they resolve through the same PATH that already
 * finds MiKTeX.
 *
 * The engine runs TWICE. `hyperref` and page references settle on the second pass, and a one-pass
 * build of a document with links produces a PDF whose link annotations can be missing.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type LatexEngine = "pdflatex" | "xelatex" | "latexmk";

const ENGINES: LatexEngine[] = ["pdflatex", "xelatex", "latexmk"];

const PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_COMPILE_TIMEOUT_MS = 60_000;

/**
 * Kill a spawned command and everything it spawned.
 *
 * Copied from `runner.ts:437-450`, and for the same reason: `proc.kill()` targets the direct child
 * only, and a TeX run that spawns helper processes would leave them holding the pipe. Windows has
 * no process groups (`process.kill(-pid)` throws there), so `taskkill /T` walks the child tree
 * instead.
 */
function killTree(proc: { pid: number; kill: () => void }): void {
  try {
    if (process.platform === "win32") {
      Bun.spawnSync(["taskkill", "/PID", String(proc.pid), "/T", "/F"], {
        stdout: "ignore",
        stderr: "ignore",
      });
    } else {
      process.kill(-proc.pid, "SIGKILL");
    }
  } catch {
    proc.kill();
  }
}

/** POSIX only: spawning detached on Windows breaks tools that expect a console. */
const DETACH = process.platform !== "win32";

/**
 * Run a command, capturing both streams, with a kill timer.
 *
 * Returns null when the spawn throws, which is how a missing binary presents. The timer is cleared
 * in a `finally`, so a rejected await cannot leave it armed.
 */
async function run(
  cmd: string[],
  opts: { cwd?: string; timeoutMs: number },
): Promise<{ code: number; out: string; err: string } | null> {
  let proc;
  try {
    proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", cwd: opts.cwd, detached: DETACH });
  } catch {
    return null;
  }

  const killer = setTimeout(() => killTree(proc), opts.timeoutMs);
  try {
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code: await proc.exited, out, err };
  } finally {
    clearTimeout(killer);
  }
}

/** Whether a tool exists on PATH. True when the spawn did not throw. */
export async function probeTool(tool: string): Promise<boolean> {
  const r = await run([tool, "-v"], { timeoutMs: PROBE_TIMEOUT_MS });
  return r !== null;
}

/**
 * The first TeX engine that answers, or null.
 *
 * `pdflatex` first: it is the one every distribution ships and the one the ATS-oriented preamble is
 * written for. `xelatex` and `latexmk` are fallbacks for a machine that has one of those only.
 */
export async function detectLatexEngine(): Promise<LatexEngine | null> {
  for (const engine of ENGINES) {
    const r = await run([engine, "--version"], { timeoutMs: PROBE_TIMEOUT_MS });
    if (r !== null) return engine;
  }
  return null;
}

/**
 * Reduce a TeX log to the lines that say what went wrong.
 *
 * A raw log is multi-megabyte and would be useless in a response body and unreadable in a panel.
 * `-file-line-error` makes the offending file and line appear as `./cv.tex:42:`, which is the line
 * the user actually needs.
 */
function extractErrors(log: string): string {
  const lines = log.split(/\r?\n/);
  const picked: string[] = [];
  for (const line of lines) {
    if (/^!|^l\.\d+|^[^:]+\.tex:\d+:/.test(line)) picked.push(line);
    if (picked.length >= 25) break;
  }

  let out = picked.join("\n");

  // The common first-run failure: a package the distribution does not have yet. Name the package
  // and the fix, because "File `microtype.sty' not found" does not say what to do about it.
  const missing = /File `([^']+\.sty)' not found/.exec(log);
  if (missing) {
    out += `\nMissing LaTeX package ${missing[1]}: install it in MiKTeX (MiKTeX Console → Packages) and render again.`;
  }

  return out.length > 0 ? out : "(the engine produced no error lines; see the log)";
}

/**
 * Compile a document to PDF.
 *
 * The temp directory is removed in a `finally`, so a failed compile does not leak a directory per
 * attempt. The `.log` is read before the cleanup, which is why the cleanup is the last thing that
 * happens.
 */
export async function compileLatex(
  tex: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: true; pdf: Uint8Array; log: string } | { ok: false; error: string; log: string }> {
  const engine = await detectLatexEngine();
  if (!engine) {
    return {
      ok: false,
      error: "no LaTeX engine found",
      log: "Install MiKTeX (or TeX Live) so `pdflatex` is on PATH.",
    };
  }

  const dir = await mkdtemp(join(tmpdir(), "prep_tex_"));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_COMPILE_TIMEOUT_MS;

  try {
    await writeFile(join(dir, "cv.tex"), tex, "utf8");

    const args = [
      engine,
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      `-output-directory=${dir}`,
      "cv.tex",
    ];

    // Twice, so hyperref's links and any page references settle.
    for (let pass = 0; pass < 2; pass++) {
      const r = await run(args, { cwd: dir, timeoutMs });
      if (r === null) {
        return { ok: false, error: `${engine} could not be started`, log: "" };
      }
      if (r.code !== 0) {
        const log = await readFile(join(dir, "cv.log"), "utf8").catch(() => r.err + r.out);
        return { ok: false, error: extractErrors(log), log };
      }
    }

    const pdf = await readFile(join(dir, "cv.pdf")).catch(() => null);
    if (!pdf) {
      const log = await readFile(join(dir, "cv.log"), "utf8").catch(() => "");
      return { ok: false, error: "the engine reported success but produced no PDF", log };
    }

    const log = await readFile(join(dir, "cv.log"), "utf8").catch(() => "");
    return { ok: true, pdf, log };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Run a tool on a file, returning stdout. Null when the tool is missing or fails. */
export async function runTool(
  cmd: string[],
  opts: { timeoutMs?: number } = {},
): Promise<string | null> {
  const r = await run(cmd, { timeoutMs: opts.timeoutMs ?? 15_000 });
  if (r === null) return null;
  // `pdffonts`/`pdfinfo` write their table to stdout and exit 0; a non-zero exit means the PDF was
  // unreadable, which the caller reports as a failed check rather than a crash.
  return r.code === 0 ? r.out : null;
}
