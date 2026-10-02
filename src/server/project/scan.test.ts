/**
 * The scanner's rules, each one a case that would otherwise fail silently.
 *
 * The scanner reads a directory the user points at, so the failure modes are not "wrong answer"
 * but "walked into node_modules", "followed a symlink out of the tree", "read a 40 MB bundle", or
 * "one unreadable file killed the import". Each assertion below pins one of those.
 *
 * `node:fs/promises` is stubbed so the read-error branch is reachable on every platform: making a
 * file genuinely unreadable needs `chmod`, which is a no-op on Windows, and a test that silently
 * stops testing anything is worse than no test.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import * as realFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

/** Files whose read is forced to fail, by basename. */
const unreadable = new Set<string>();

// Captured BEFORE the mock is registered. Reading `realFs.readFile` inside the factory would
// resolve to the mocked binding itself, so every read would recurse into the stub and the scan
// would silently come back empty.
const originalReadFile = realFs.readFile;

mock.module("node:fs/promises", () => ({
  ...realFs,
  readFile: async (path: string, ...rest: unknown[]) => {
    if (unreadable.has(join(path).split(/[\\/]/).pop() ?? "")) {
      const err = new Error(`EACCES: permission denied, open '${path}'`) as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    }
    return (originalReadFile as (...a: unknown[]) => Promise<Buffer>)(path, ...rest);
  },
}));

const { mkdir, mkdtemp, rm, symlink, writeFile } = realFs;
// Dynamic import because `mock.module` must be registered BEFORE the module under test is
// evaluated: `scan.ts` binds `readFile` at import time, so a static import here would capture the
// real one and the read-error branch would be unreachable.
const { resolveProjectRoot, scanProject, summariseScan } = await import("./scan.ts");

const dirs: string[] = [];

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prep-scan-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  unreadable.clear();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe("scanProject", () => {
  test("node_modules is never descended into", async () => {
    const root = await fixture();
    await writeFile(join(root, "index.ts"), "export const a = 1;\n");
    await mkdir(join(root, "node_modules", "left-pad"), { recursive: true });
    await writeFile(join(root, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");

    const scan = await scanProject(root);
    expect(scan.files.map((f) => f.rel)).toEqual(["index.ts"]);
    expect(scan.skipped.some((s) => s.rel === "node_modules" && s.reason === "ignored")).toBe(true);
  });

  test("a file over 256 KB is skipped as large, not read", async () => {
    const root = await fixture();
    await writeFile(join(root, "small.ts"), "export const a = 1;\n");
    await writeFile(join(root, "big.ts"), "x".repeat(300 * 1024));

    const scan = await scanProject(root);
    expect(scan.files.map((f) => f.rel)).toEqual(["small.ts"]);
    expect(scan.skipped.find((s) => s.rel === "big.ts")?.reason).toBe("large");
  });

  test("a NUL byte makes a file binary", async () => {
    const root = await fixture();
    await writeFile(join(root, "text.ts"), "export const a = 1;\n");
    await writeFile(join(root, "blob.ts"), Buffer.from([0x61, 0x00, 0x62]));

    const scan = await scanProject(root);
    expect(scan.files.map((f) => f.rel)).toEqual(["text.ts"]);
    expect(scan.skipped.find((s) => s.rel === "blob.ts")?.reason).toBe("binary");
  });

  test("a symlinked directory is not traversed", async () => {
    const root = await fixture();
    const outside = await fixture();
    await writeFile(join(outside, "secret.ts"), "export const secret = 1;\n");
    await writeFile(join(root, "index.ts"), "export const a = 1;\n");
    // A junction, not a symlink: creating a symlink on Windows needs elevation, and the scanner
    // rejects both through the same `isSymbolicLink` check.
    await symlink(outside, join(root, "linked"), "junction");

    const scan = await scanProject(root);
    expect(scan.files.map((f) => f.rel)).toEqual(["index.ts"]);
    expect(scan.skipped.some((s) => s.rel === "linked")).toBe(true);
  });

  test("an unrecognised extension is skipped rather than guessed at", async () => {
    const root = await fixture();
    await writeFile(join(root, "index.ts"), "export const a = 1;\n");
    await writeFile(join(root, "notes.xyz"), "whatever\n");

    const scan = await scanProject(root);
    expect(scan.files.map((f) => f.rel)).toEqual(["index.ts"]);
    expect(scan.skipped.find((s) => s.rel === "notes.xyz")?.reason).toBe("ignored");
  });

  test("an unreadable file is skipped and the rest of the scan completes", async () => {
    const root = await fixture();
    await writeFile(join(root, "index.ts"), "export const a = 1;\n");
    await writeFile(join(root, "locked.ts"), "export const b = 2;\n");
    unreadable.add("locked.ts");

    const scan = await scanProject(root);
    expect(scan.files.map((f) => f.rel)).toEqual(["index.ts"]);
    expect(scan.skipped.find((s) => s.rel === "locked.ts")?.reason).toBe("ignored");
  });

  test("a vendored dependency tree is skipped at any depth", async () => {
    const root = await fixture();
    await writeFile(join(root, "index.ts"), "export const a = 1;\n");
    // `training/.venv` is reached THROUGH `training/`, so an exact-name check on the root's children
    // never sees it. Without the pattern rule, 14,100 third-party files consumed the whole cap on
    // the real project this was written for.
    await mkdir(join(root, "training", ".venv", "Lib"), { recursive: true });
    await writeFile(join(root, "training", ".venv", "Lib", "third_party.py"), "x = 1\n");
    await mkdir(join(root, "vendor", ".llamacpp"), { recursive: true });
    await writeFile(join(root, "vendor", ".llamacpp", "llama.py"), "y = 2\n");
    await writeFile(join(root, "training", "train.py"), "z = 3\n");

    const scan = await scanProject(root);
    const rels = scan.files.map((f) => f.rel);
    expect(rels).toContain("index.ts");
    expect(rels).toContain("training/train.py".replace("/", sep));
    expect(rels.some((r) => r.includes(".venv"))).toBe(false);
    expect(rels.some((r) => r.includes(".llamacpp"))).toBe(false);
  });

  test("the cap is spent across top-level directories, not inside one of them", async () => {
    const root = await fixture();
    // One directory with far more files than the cap, and a small one that must still be seen.
    await mkdir(join(root, "big"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    for (let i = 0; i < 30; i++) await writeFile(join(root, "big", `f${String(i).padStart(2, "0")}.ts`), "x\n");
    await writeFile(join(root, "src", "main.ts"), "export const main = 1;\n");

    const scan = await scanProject(root);
    // A plain depth sort would take all 30 `big` files before reaching `src`.
    expect(scan.files.some((f) => f.rel.endsWith("main.ts"))).toBe(true);
  });

  test("the file cap truncates and says so", async () => {
    const root = await fixture();
    // 401 files, one over MAX_FILES, all at the same depth so the sort is by path.
    for (let i = 0; i < 401; i++) {
      await writeFile(join(root, `f${String(i).padStart(3, "0")}.ts`), "export const a = 1;\n");
    }

    const scan = await scanProject(root);
    expect(scan.files.length).toBe(400);
    expect(scan.truncated).toBe(true);
    expect(scan.files[0]!.rel).toBe("f000.ts");
    expect(scan.files.at(-1)!.rel).toBe("f399.ts");
  });

  test("summariseScan drops file text and counts per language", async () => {
    const root = await fixture();
    await writeFile(join(root, "index.ts"), "export const a = 1;\n");
    await writeFile(join(root, "app.py"), "a = 1\n");

    const scan = await scanProject(root);
    const summary = summariseScan(scan);
    expect(summary).toEqual({
      root: scan.root,
      fileCount: 2,
      totalBytes: scan.totalBytes,
      truncated: false,
      byLang: { typescript: 1, python: 1 },
    });
    expect(JSON.stringify(summary)).not.toContain("export const");
  });
});

describe("resolveProjectRoot", () => {
  test("a directory resolves to an absolute path", async () => {
    const root = await fixture();
    expect(resolveProjectRoot(root)).toBe(resolve(root));
  });

  test("a missing path and a file both throw", async () => {
    const root = await fixture();
    const file = join(root, "index.ts");
    await writeFile(file, "export const a = 1;\n");
    expect(() => resolveProjectRoot(join(root, "nope"))).toThrow("not a directory");
    expect(() => resolveProjectRoot(file)).toThrow("not a directory");
  });
});
