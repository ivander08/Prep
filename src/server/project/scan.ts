/**
 * Read a project directory into a file map.
 *
 * This is the first code in the repo that reads a directory the user points at, so every rule is
 * explicit and conservative: symlinks are never followed (a symlinked `node_modules` or a loop
 * cannot be traversed), the heavy build/vendor directories are named rather than guessed, and a
 * single unreadable file is skipped instead of failing the whole scan. The hard caps exist so a
 * mistaken path (`C:\`) cannot read the machine into memory.
 *
 * The scan is also the source of truth for the generator: a path the model proposes that is not
 * in `files` is dropped, so a hallucinated file cannot enter the curriculum.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

/** Directories never descended into, matched by exact name. */
const SKIP_DIRS: Record<string, true> = {
  node_modules: true, ".git": true, dist: true, build: true, out: true, target: true,
  vendor: true, bin: true, obj: true, ".next": true, ".venv": true, venv: true,
  __pycache__: true, ".cache": true, coverage: true, ".turbo": true, ".idea": true,
  ".vscode": true,
};

/**
 * Vendored dependency trees, matched by directory NAME at any depth.
 *
 * A checked-in third-party checkout is thousands of files the project did not write. One of them
 * filling the scan cap is the difference between a curriculum about the user's code and one about
 * somebody else's, and it is why `.llamacpp` and `site-packages` are here by name: the exact-name
 * skip list cannot enumerate every vendored tree a project might contain.
 */
const VENDORED_RE = /^(\.llamacpp|site-packages|\.venv|venv|\.tox|\.gradle|\.m2|\.cargo|\.bundle|\.terraform|\.serverless|\.parcel-cache)$/i;

/** Extension -> language tag. A file with no mapping is skipped as `ignored`. */
const LANG_BY_EXT: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".rs": "rust",
  ".c": "cpp", ".h": "cpp", ".cc": "cpp", ".cpp": "cpp", ".hpp": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".sql": "sql",
  ".sh": "shell", ".bash": "shell",
  ".md": "markdown", ".mdx": "markdown",
  ".json": "config", ".yaml": "config", ".yml": "config", ".toml": "config", ".ini": "config",
  ".example": "config",
  ".html": "web", ".css": "web", ".scss": "web",
  ".dockerfile": "docker",
};

const LARGE_BYTES = 262_144; // 256 KB
const MAX_TOTAL_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_FILES = 400;
const BINARY_PROBE_BYTES = 8 * 1024;
const MINIFIED_LINE = 400;

export type ScannedFile = { rel: string; bytes: number; lang: string; text: string };
export type ScanResult = {
  root: string;
  files: ScannedFile[];
  skipped: Array<{ rel: string; reason: "binary" | "large" | "ignored" | "minified" }>;
  totalBytes: number;
  truncated: boolean;
};
/** What `projects.scan_json` stores: the scan without any file text. */
export type ScanSummary = {
  root: string;
  fileCount: number;
  totalBytes: number;
  truncated: boolean;
  byLang: Record<string, number>;
};

/**
 * Resolve a user-supplied directory path.
 *
 * Throws rather than returning null: a bad path is a 400 with the path in the message, not a
 * silently empty project.
 */
export function resolveProjectRoot(input: string): string {
  let info;
  try {
    info = statSync(input);
  } catch {
    throw new Error(`not a directory: ${input}`);
  }
  if (!info.isDirectory()) throw new Error(`not a directory: ${input}`);
  return resolve(input);
}

// `statSync` is imported above alongside the async walker's imports; the sync stat of the ROOT is
// the one blocking call, and it is a single call.

/** The language tag for a file, or null when its extension is not recognised. */
export function langFor(rel: string): string | null {
  const base = basename(rel).toLowerCase();
  if (base === "dockerfile" || base.endsWith(".dockerfile")) return "docker";
  if (base === ".env.example" || base.endsWith(".env.example")) return "config";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return null;
  return LANG_BY_EXT[base.slice(dot)] ?? null;
}

/** A NUL byte in the first 8 KB means binary; that is what `file(1)` checks too. */
function looksBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, BINARY_PROBE_BYTES);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** A `.min.js`/`.min.css`, or a `.js`/`.css` whose first lines are one enormous line. */
function looksMinified(rel: string, text: string): boolean {
  if (/\.min\./i.test(basename(rel))) return true;
  if (!/\.(js|css)$/i.test(rel)) return false;
  const head = text.slice(0, 400);
  return head.split("\n").some((line) => line.length > MINIFIED_LINE);
}

/** Path depth, so the cap keeps files nearer the root. */
function depth(rel: string): number {
  let n = 0;
  for (let i = 0; i < rel.length; i++) if (rel[i] === sep || rel[i] === "/") n++;
  return n;
}

/**
 * How much a path looks like the project's own source, lowest first.
 *
 * The scan is capped, so the ORDER candidates are considered in decides what a large project's
 * curriculum is even able to see. Depth alone got this wrong on a real repo: a vendored
 * `training/.llamacpp` tree and a nested `training/.venv` (14,100 third-party files) consumed the
 * entire budget, and the project's own `src/**` never entered the scan.
 *
 * A dot-directory ANYWHERE in the path ranks last, not just at the top level. The walker's skip
 * list already refuses to descend into a directory named `.venv` when it is the project root's
 * child, but `training/.venv` is reached through `training/`, so the name check never fires on it.
 *
 * Markdown and config rank below code, because a README is context for the generator (which reads
 * the manifest separately) rather than something to spend the file budget on.
 */
function sourceRank(rel: string): number {
  const segments = rel.split(/[\\/]/);
  const base = segments[segments.length - 1] ?? "";

  if (segments.some((s) => s.startsWith(".") && s !== "." && s !== "..")) return 3;
  if (base === "README.md" || base === "package.json") return 0;

  const lang = langFor(rel);
  if (lang === "markdown" || lang === "config") return 2;
  return 1;
}

/**
 * Walk `root` and read every recognised source file.
 *
 * Deterministic: candidates are collected, sorted by depth then path, and the caps are applied to
 * that order, so the same directory always yields the same file set.
 */
export async function scanProject(root: string): Promise<ScanResult> {
  const files: ScannedFile[] = [];
  const skipped: ScanResult["skipped"] = [];
  let totalBytes = 0;
  let truncated = false;

  /** Candidate paths, collected first so the cap can prefer files nearer the root. */
  const candidates: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // An unreadable directory is skipped, not fatal.
      skipped.push({ rel: relative(root, dir) || ".", reason: "ignored" });
      return;
    }

    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs);

      // Never followed: a symlinked directory could escape the tree or loop.
      if (entry.isSymbolicLink()) {
        skipped.push({ rel, reason: "ignored" });
        continue;
      }

      if (entry.isDirectory()) {
        // Named exactly, or matched as a vendored dependency tree. The second rule is what keeps a
        // checked-in third-party checkout (`.llamacpp`, `site-packages`, `.venv`) out of the
        // budget: those are thousands of files the project did not write, and one of them filling
        // the cap is the difference between a curriculum about the user's code and one about
        // somebody else's.
        if (SKIP_DIRS[entry.name] || VENDORED_RE.test(entry.name)) {
          skipped.push({ rel, reason: "ignored" });
          continue;
        }
        await walk(abs);
        continue;
      }

      if (!entry.isFile()) {
        skipped.push({ rel, reason: "ignored" });
        continue;
      }

      if (!langFor(rel)) {
        skipped.push({ rel, reason: "ignored" });
        continue;
      }

      candidates.push(abs);
    }
  }

  await walk(root);

  // Order before the cap applies, so a large project's budget goes to its SOURCE rather than to
  // whatever happens to sit nearest the root.
  //
  // A plain sort is not enough, and id-eval is why: 57,341 files, of which 3,660 are a vendored
  // `training/.llamacpp` tree. Depth-ordering spent 359 of the 400-file budget inside `training/`
  // and left 14 slots for the project's actual `src/ideval/**`, so the curriculum planned itself
  // around llama.cpp. Sorting cannot fix that, because the greedy prefix is what the cap takes.
  //
  // So candidates are INTERLEAVED across top-level directories, best-first within each. Every part
  // of the project gets a turn before any part gets a second one, which is what "representative
  // sample" has to mean when the sample is capped. Within a directory, `sourceRank` puts code above
  // prose and above dot-directories, and depth breaks remaining ties.
  const groups = new Map<string, string[]>();
  for (const abs of candidates) {
    const rel = relative(root, abs);
    const top = rel.split(/[\\/]/)[0]!;
    const bucket = groups.get(top);
    if (bucket) bucket.push(abs);
    else groups.set(top, [abs]);
  }

  const ordered: string[] = [];
  const orderedGroups = [...groups.values()];
  for (const bucket of orderedGroups) {
    bucket.sort((a, b) => {
      const ra = relative(root, a);
      const rb = relative(root, b);
      const ka = sourceRank(ra);
      const kb = sourceRank(rb);
      if (ka !== kb) return ka - kb;
      const da = depth(ra);
      const db = depth(rb);
      if (da !== db) return da - db;
      return ra < rb ? -1 : ra > rb ? 1 : 0;
    });
  }

  // Round-robin, one file per directory per pass, until every directory is exhausted.
  for (let i = 0; ; i++) {
    let added = false;
    for (const bucket of orderedGroups) {
      if (i < bucket.length) {
        ordered.push(bucket[i]!);
        added = true;
      }
    }
    if (!added) break;
  }

  for (const abs of ordered) {
    const rel = relative(root, abs);
    if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) {
      truncated = true;
      break;
    }

    let size = 0;
    try {
      size = (await stat(abs)).size;
    } catch {
      skipped.push({ rel, reason: "ignored" });
      continue;
    }

    if (size > LARGE_BYTES) {
      skipped.push({ rel, reason: "large" });
      continue;
    }

    let buf: Buffer;
    try {
      buf = await readFile(abs);
    } catch {
      // EACCES, EISDIR, or anything else: one bad file must not fail the scan.
      skipped.push({ rel, reason: "ignored" });
      continue;
    }

    if (looksBinary(buf)) {
      skipped.push({ rel, reason: "binary" });
      continue;
    }

    const text = buf.toString("utf8");
    if (looksMinified(rel, text)) {
      skipped.push({ rel, reason: "minified" });
      continue;
    }

    files.push({ rel, bytes: size, lang: langFor(rel)!, text });
    totalBytes += size;
  }

  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  skipped.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  return { root, files, skipped, totalBytes, truncated };
}

/**
 * Whether a path is one the scanner WOULD have included, judged from its name alone.
 *
 * Needed because the scan is capped: a project with tens of thousands of files fills the 400-file
 * budget with whatever is nearest the root, and the model — which sees only that list — then names
 * real files the cap excluded. Those are not hallucinations, and dropping them discards the best
 * part of the plan. This check is name-only and deliberately permissive: it answers "could this be
 * a source file", not "did the scanner read it".
 */
export function isScannableFile(rel: string): boolean {
  if (rel.length === 0 || rel.startsWith("/") || rel.includes("..")) return false;
  if (!langFor(rel)) return false;
  return !rel.split(/[\\/]/).some((seg) => SKIP_DIRS[seg]);
}

/** The summary stored in `projects.scan_json`. */
export function summariseScan(scan: ScanResult): ScanSummary {
  const byLang: Record<string, number> = {};
  for (const f of scan.files) byLang[f.lang] = (byLang[f.lang] ?? 0) + 1;
  return {
    root: scan.root,
    fileCount: scan.files.length,
    totalBytes: scan.totalBytes,
    truncated: scan.truncated,
    byLang,
  };
}
