/**
 * Build a curriculum from a project's source.
 *
 * Two model calls, in sequence: one to plan the module map from the file listing, then one per
 * module to write the study document and its interview questions from that module's actual file
 * text. The whole run is driven from `project_jobs`, which the UI polls — the HTTP request that
 * starts a run returns immediately and never holds the connection open.
 *
 * Two rules shape the prompts, both inherited from the app's existing stance:
 *   1. Every factual claim must be traceable to the supplied file text. Where the files do not
 *      show something, the model writes "not visible in the provided files" rather than guessing.
 *   2. A path the model proposes that is not in the scan is DROPPED, not fatal. The scan is the
 *      authority on what exists; a hallucinated file cannot enter the curriculum.
 *
 * All database writes are synchronous `db.run` calls. `bun:sqlite` transactions are synchronous,
 * so awaiting model work inside one would be a bug; the model call always happens first and the
 * write after it.
 */

import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { db } from "../db.ts";
import { structured, KenariError, type CallMeta, type ToolDef } from "../tutor/client.ts";
import { scanProject, summariseScan, isScannableFile, type ScanResult, type ScanSummary } from "./scan.ts";

export type GenerationPhase = "scan" | "map" | "modules" | "questions" | "done";
export type GenerationProgress = { phase: GenerationPhase; done: number; total: number; note: string };

/** The plan the map call returns. */
type ModulePlan = { title: string; objective: string; files: string[] };
type MapPayload = { stack: string[]; modulePlan: ModulePlan[] };

export type Question = { q: string; lookFor: string[]; commonMistakes: string[] };
type ModulePayload = { title: string; studyMd: string; questions: Question[] };

/** A module row as the generator writes it. */
type GeneratedModule = {
  slug: string;
  position: number;
  title: string;
  objective: string;
  files: string[];
  studyMd: string;
  questions: Question[];
};

/** A module row that already exists, reused verbatim when its file set has not changed. */
type ExistingModule = { slug: string; title: string; objective: string; studyMd: string; questions: Question[] };

const MAX_MODULES = 12;
const MIN_MODULES = 3;
const MAX_FILES_PER_MODULE = 20;
const MIN_FILES_PER_MODULE = 2;
const PER_FILE_CHARS = 12_000;
const MODULE_PAYLOAD_CHARS = 60_000;
/** Mirrors the scanner's own caps, for files the scan never reached. */
const LARGE_BYTES = 262_144;
const BINARY_PROBE_BYTES = 8 * 1024;

/** The six required `##` sections, in order. A study document missing one is incomplete. */
export const REQUIRED_SECTIONS = [
  "What this part does",
  "How it works",
  "Key files",
  "How it fits",
  "Gotchas",
  "Interview angles",
] as const;

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

/** A URL- and ref-safe slug. No collision handling here; `uniqueSlug` does that. */
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

/** `slug`, or `slug-2`, `slug-3`… when the taken set already holds it. */
function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** `01-entry-point`: position-prefixed so the ordering is visible in the ref itself. */
function moduleSlug(position: number, title: string): string {
  return `${String(position).padStart(2, "0")}-${slugify(title)}`;
}

/** The identity a module is matched by across regenerations: its sorted file set. */
function fileSetKey(files: string[]): string {
  return [...files].sort().join("\n");
}

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

const MAP_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "submit_map",
    description: "Submit the stack and the ordered module plan for this project.",
    parameters: {
      type: "object",
      properties: {
        stack: {
          type: "array",
          items: { type: "string" },
          description: "The languages, frameworks and tools the project actually uses.",
        },
        modulePlan: {
          type: "array",
          minItems: MIN_MODULES,
          maxItems: MAX_MODULES,
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              objective: { type: "string" },
              files: {
                type: "array",
                items: { type: "string" },
                minItems: MIN_FILES_PER_MODULE,
                maxItems: MAX_FILES_PER_MODULE,
              },
            },
            required: ["title", "objective", "files"],
          },
        },
      },
      required: ["stack", "modulePlan"],
    },
  },
};

const MODULE_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "submit_module",
    description: "Submit the study document and interview questions for one module.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        studyMd: { type: "string" },
        questions: {
          type: "array",
          minItems: 4,
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              q: { type: "string" },
              lookFor: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
              commonMistakes: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
            },
            required: ["q", "lookFor", "commonMistakes"],
          },
        },
      },
      required: ["title", "studyMd", "questions"],
    },
  },
};

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * The map, with hallucinated paths dropped.
 *
 * A path is accepted when the scan READ it, or when it exists on disk and is the kind of file the
 * scanner would have read. The second case is not a loophole: the scan is capped at 400 files, so a
 * large project fills the budget with whatever is nearest the root and the model — which sees only
 * that list — names real files the cap excluded. Treating those as hallucinations dropped the
 * model's best modules and failed the run with "2 of 3 survived" on a project whose source is
 * perfectly scannable.
 *
 * Only two things are fatal: fewer than three modules surviving, or a module left with fewer than
 * two usable files.
 */
function validateMap(scan: ScanResult) {
  const known = new Set(scan.files.map((f) => f.rel));
  return (value: unknown): { ok: true; value: MapPayload } | { ok: false; missing: string[] } => {
    if (typeof value !== "object" || value === null) return { ok: false, missing: ["stack", "modulePlan"] };
    const v = value as Record<string, unknown>;
    const missing: string[] = [];

    /**
     * A path the scan read, or one it was capped out of but which is really there.
     *
     * `existsSync` rather than a name check alone: a name that passes the extension filter but is
     * not on disk is exactly the hallucination this rejects, and accepting it would leave the
     * module with no file text while still counting as a surviving module.
     */
    const usable = (rel: string): boolean =>
      known.has(rel) || (isScannableFile(rel) && existsSync(join(scan.root, rel)));

    const stack = Array.isArray(v.stack)
      ? v.stack.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim())
      : [];
    if (stack.length === 0) missing.push("stack[]");

    const modulePlan: ModulePlan[] = [];
    if (Array.isArray(v.modulePlan)) {
      for (const raw of v.modulePlan) {
        if (typeof raw !== "object" || raw === null) continue;
        const m = raw as Record<string, unknown>;
        const title = typeof m.title === "string" ? m.title.trim() : "";
        if (title.length === 0) continue;

        const proposed = Array.isArray(m.files)
          ? m.files.filter((f): f is string => typeof f === "string")
          : [];
        const files = [...new Set(proposed.filter(usable))].slice(0, MAX_FILES_PER_MODULE);
        if (files.length < MIN_FILES_PER_MODULE) continue;

        modulePlan.push({
          title,
          objective: typeof m.objective === "string" ? m.objective.trim() : "",
          files,
        });
      }
    }

    if (modulePlan.length < MIN_MODULES) {
      missing.push(`modulePlan[] (${modulePlan.length} of ${MIN_MODULES} survived)`);
    }
    if (missing.length > 0) return { ok: false, missing };
    return { ok: true, value: { stack, modulePlan: modulePlan.slice(0, MAX_MODULES) } };
  };
}

/**
 * The module call's output budget.
 *
 * 16000, measured, not chosen. A module must emit a ~12,000-character study document plus six
 * questions, and the budget that works depends on the INPUT size, because a bigger payload makes
 * the model reason longer before it emits the tool call. Measured on id-eval, `deepseek-v4-1-flash`:
 *
 *   payload  35k chars, maxTokens  8000 -> finish=length, no tool call
 *   payload  60k chars, maxTokens  8000 -> finish=length, no tool call
 *   payload  60k chars, maxTokens 16000 -> finish=tool_calls, valid module
 *   payload  35k chars, maxTokens 16000 -> finish=tool_calls, valid module
 *
 * At 8000 the whole budget goes to reasoning and NO tool call comes back at all, which surfaces as
 * "structured output failed validation twice" and fails the run on its first module. This is the
 * trap `client.ts` documents as Rule 3, and the fix is the same: give the budget the output needs.
 */
const MODULE_MAX_TOKENS = 16_000;

/**
 * The module payload, requiring all six `##` sections.
 *
 * Questions are trimmed to the 4-6 window rather than rejected for overshooting it: the model
 * returned 7 on a real run, and failing the module — and with it the whole run — over one extra
 * question is a worse outcome than dropping the seventh. Fewer than 4 is still a rejection, because
 * that is a module the user cannot practise.
 */
function validateModule(value: unknown): { ok: true; value: ModulePayload } | { ok: false; missing: string[] } {
  if (typeof value !== "object" || value === null) return { ok: false, missing: ["title", "studyMd", "questions"] };
  const v = value as Record<string, unknown>;
  const missing: string[] = [];

  const title = typeof v.title === "string" ? v.title.trim() : "";
  if (title.length === 0) missing.push("title");

  const studyMd = typeof v.studyMd === "string" ? v.studyMd : "";
  const absent = REQUIRED_SECTIONS.filter((s) => !new RegExp(`^##\\s+${s}\\s*$`, "m").test(studyMd));
  if (absent.length > 0) missing.push(`studyMd missing sections: ${absent.join(", ")}`);

  const questions: Question[] = [];
  if (Array.isArray(v.questions)) {
    for (const raw of v.questions) {
      if (typeof raw !== "object" || raw === null) continue;
      const q = raw as Record<string, unknown>;
      const text = typeof q.q === "string" ? q.q.trim() : "";
      if (text.length === 0) continue;
      const lookFor = Array.isArray(q.lookFor)
        ? q.lookFor.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
        : [];
      const commonMistakes = Array.isArray(q.commonMistakes)
        ? q.commonMistakes.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
        : [];
      if (lookFor.length < 2) continue;
      questions.push({ q: text, lookFor: lookFor.slice(0, 6), commonMistakes: commonMistakes.slice(0, 4) });
    }
  }
  if (questions.length < 4) missing.push(`questions[] (${questions.length}, need at least 4)`);

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, value: { title, studyMd, questions: questions.slice(0, 6) } };
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

/** The file map sent to the map call: one line per file, no text. */
function fileMapBlock(scan: ScanResult): string {
  const lines = scan.files.map((f) => `${f.rel}\t${f.bytes}\t${f.lang}`);
  const tail = scan.truncated ? `\n(truncated: only the first ${scan.files.length} files were read)` : "";
  return `${lines.join("\n")}${tail}`;
}

/** The first 4 000 chars of each manifest that exists. */
function manifestBlock(scan: ScanResult): string {
  const wanted = ["README.md", "package.json", "pyproject.toml", "go.mod", "Cargo.toml"];
  const present = scan.files.filter((f) => wanted.includes(f.rel));
  if (present.length === 0) return "(no README or package manifest was read)";
  return present.map((f) => `## ${f.rel}\n${f.text.slice(0, 4_000)}`).join("\n\n");
}

/**
 * One module's files, with the per-file and whole-payload budgets applied.
 *
 * A file the scan read is taken from memory; one the cap excluded is read from disk here, and
 * skipped when it has since vanished, grown past the per-file cap, or turned out to be binary.
 * Files are dropped largest-first when the payload is over budget, because the biggest file is
 * usually generated or vendored data and the smallest is usually the entry point. What was dropped
 * is named at the end so the model knows what it did not see and does not claim otherwise.
 */
async function moduleFilesBlock(
  root: string,
  scan: ScanResult,
  files: string[],
): Promise<{ block: string; omitted: string[] }> {
  const byRel = new Map(scan.files.map((f) => [f.rel, f]));

  const chosen: Array<{ rel: string; bytes: number; text: string }> = [];
  for (const rel of files) {
    const scanned = byRel.get(rel);
    if (scanned) {
      chosen.push({ rel, bytes: scanned.bytes, text: scanned.text });
      continue;
    }

    const abs = join(root, rel);
    try {
      const info = await stat(abs);
      if (!info.isFile() || info.size > LARGE_BYTES) continue;
      const buf = await readFile(abs);
      // The same binary check the scanner applies; a file the cap excluded has not been through it.
      if (buf.subarray(0, BINARY_PROBE_BYTES).includes(0)) continue;
      chosen.push({ rel, bytes: info.size, text: buf.toString("utf8") });
    } catch {
      // Gone, unreadable, or a directory: the module simply does not include it.
    }
  }

  const omitted: string[] = [];
  const drop = new Set<string>();
  let budget = MODULE_PAYLOAD_CHARS;

  for (const f of [...chosen].sort((a, b) => b.bytes - a.bytes)) {
    const cost = Math.min(f.text.length, PER_FILE_CHARS) + f.rel.length + 8;
    if (budget - cost < 0) {
      drop.add(f.rel);
      omitted.push(f.rel);
    } else {
      budget -= cost;
    }
  }

  const parts = chosen
    .filter((f) => !drop.has(f.rel))
    .map((f) => `# ${f.rel}\n${f.text.slice(0, PER_FILE_CHARS)}`);

  if (omitted.length > 0) parts.push(`# Omitted: ${omitted.join(", ")}`);
  return { block: parts.join("\n\n"), omitted };
}

const MAP_SYSTEM = [
  "You plan a curriculum that teaches a developer their OWN codebase, thoroughly enough to explain it in an interview.",
  "",
  "Order the modules as a learning path: foundations first, then the core flows, then the parts an interviewer would probe. Each module covers one coherent area of the codebase.",
  "",
  "Rules:",
  `- Between ${MIN_MODULES} and ${MAX_MODULES} modules.`,
  `- Every module lists between ${MIN_FILES_PER_MODULE} and ${MAX_FILES_PER_MODULE} files.`,
  "- Every path MUST be copied VERBATIM from the file map provided. A path that is not in the map will be discarded.",
  "- `objective` states what the learner should be able to explain after the module, in one sentence.",
].join("\n");

const MODULE_SYSTEM = [
  "You write one module of a curriculum that teaches a developer their OWN codebase.",
  "",
  "The study document MUST contain these six sections, in this order, with these exact headings:",
  ...REQUIRED_SECTIONS.map((s) => `## ${s}`),
  "",
  "Rules:",
  '- Every factual claim MUST be traceable to the supplied file text. Where the files do not show something, write "not visible in the provided files" instead of guessing.',
  "- `## Key files` MUST cite `path:line` for every claim it makes.",
  "- `## How it fits` explains how this module's code is reached and what depends on it.",
  "- Write 4 to 6 interview questions about THIS module's code, each with 2-6 `lookFor` points (the answer key) and 1-4 `commonMistakes`.",
  "- The questions must be answerable only by someone who read this module's code, not by general knowledge.",
].join("\n");

// ---------------------------------------------------------------------------
// Job state
// ---------------------------------------------------------------------------

function setJob(projectId: number, status: string, progress: GenerationProgress, error: string | null = null): void {
  db.run(
    `INSERT INTO project_jobs (project_id, status, progress, error, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       status = excluded.status, progress = excluded.progress,
       error = excluded.error, updated_at = excluded.updated_at`,
    [projectId, status, JSON.stringify(progress), error, new Date().toISOString()],
  );
}

/** The project row the generator needs. Throws when the id is unknown. */
function readProject(projectId: number): { id: number; slug: string; name: string; root: string; generated_at: string | null } {
  const row = db
    .query<{ id: number; slug: string; name: string; root: string; generated_at: string | null }, [number]>(
      "SELECT id, slug, name, root, generated_at FROM projects WHERE id = ?",
    )
    .get(projectId);
  if (!row) throw new Error(`unknown project: ${projectId}`);
  return row;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Create the project row and its job, and return the id.
 *
 * The caller starts `runGeneration` with `void` and returns 202 immediately, so no HTTP request is
 * held open for the length of a generation run.
 */
export function startGeneration(input: { root: string; name?: string }): number {
  const name = (input.name ?? basename(input.root)) || "project";
  const taken = new Set(db.query<{ slug: string }, []>("SELECT slug FROM projects").all().map((r) => r.slug));
  const slug = uniqueSlug(slugify(name), taken);
  const now = new Date().toISOString();

  db.run(`INSERT INTO projects (slug, name, root, created_at, status) VALUES (?, ?, ?, ?, 'running')`, [
    slug,
    name,
    input.root,
    now,
  ]);
  const id = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
  setJob(id, "running", { phase: "scan", done: 0, total: 1, note: "scanning the directory" });
  return id;
}

/**
 * Run the full generation for a project that already has a row.
 *
 * Never throws to its caller: every failure is recorded on the project and job rows, which is what
 * the UI reads. A `KenariError` message (including "no API key…") is surfaced verbatim, the same
 * behaviour the tutor uses.
 *
 * `carryOver` maps a module's file set to the already-generated modules with that file set. Those
 * are reused verbatim and cost no model call. A list, not a single entry: two planned modules can
 * legitimately name the same files, and a one-entry map would hand the second module the first's
 * slug and silently overwrite its row.
 */
export async function runGeneration(
  projectId: number,
  carryOver: Map<string, ExistingModule[]> = new Map(),
): Promise<void> {
  const project = readProject(projectId);
  let costIdr = 0;
  let model: string | null = null;

  const account = (meta: CallMeta): void => {
    costIdr += meta.cost.idr;
    model = meta.model;
  };

  try {
    // 1. scan
    setJob(projectId, "running", { phase: "scan", done: 0, total: 1, note: "reading the directory" });
    const scan = await scanProject(project.root);
    const summary: ScanSummary = summariseScan(scan);
    db.run("UPDATE projects SET scan_json = ? WHERE id = ?", [JSON.stringify(summary), projectId]);
    setJob(projectId, "running", { phase: "scan", done: 1, total: 1, note: `${summary.fileCount} files` });

    if (scan.files.length === 0) throw new Error("no source files found in that directory");

    // 2. map
    setJob(projectId, "running", { phase: "map", done: 0, total: 1, note: "planning the modules" });
    const mapUser = [
      "# File map (path, bytes, language)",
      fileMapBlock(scan),
      "",
      "# README and manifests",
      manifestBlock(scan),
    ].join("\n");

    const mapResult = await structured(
      [
        { role: "system", content: MAP_SYSTEM },
        { role: "user", content: mapUser },
      ],
      MAP_TOOL,
      validateMap(scan),
      { role: "design", maxTokens: 3000 },
    );
    account(mapResult.meta);

    db.run("UPDATE projects SET stack = ? WHERE id = ?", [JSON.stringify(mapResult.value.stack), projectId]);
    setJob(projectId, "running", {
      phase: "map",
      done: 1,
      total: 1,
      note: `${mapResult.value.modulePlan.length} modules planned`,
    });

    // 3. modules (their questions come with them; the "questions" phase is reported while persisting)
    const plan = mapResult.value.modulePlan;
    const generated: GeneratedModule[] = [];
    const usedSlugs = new Set<string>();
    /** Modules the model failed to produce. Reported at the end instead of aborting the run. */
    const skipped: string[] = [];

    for (let i = 0; i < plan.length; i++) {
      const m = plan[i]!;
      setJob(projectId, "running", { phase: "modules", done: i, total: plan.length, note: m.title });

      const carried = carryOver.get(fileSetKey(m.files))?.shift();
      if (carried) {
        // Unchanged files: keep the study document and questions that were generated from them.
        // No model call, and the slug is kept so the review card and graded sessions stay attached.
        generated.push({
          slug: carried.slug,
          position: i + 1,
          title: carried.title,
          objective: carried.objective || m.objective,
          files: m.files,
          studyMd: carried.studyMd,
          questions: carried.questions,
        });
      } else {
        const { block, omitted } = await moduleFilesBlock(project.root, scan, m.files);
        const moduleUser = [
          `# Module: ${m.title}`,
          "",
          `Objective: ${m.objective}`,
          "",
          "# Files",
          block.length > 0 ? block : "(no file text was available)",
          omitted.length > 0 ? `\n(The following files were omitted for length: ${omitted.join(", ")})` : "",
        ].join("\n");

        let r: { value: ModulePayload; meta: CallMeta };
        try {
          r = await structured(
            [
              { role: "system", content: MODULE_SYSTEM },
              { role: "user", content: moduleUser },
            ],
            MODULE_TOOL,
            validateModule,
            { role: "design", maxTokens: MODULE_MAX_TOKENS },
          );
        } catch (e) {
          // ONE module failing does not abort the run. By this point the earlier modules are
          // already written, and discarding a project's whole curriculum because its ninth module
          // came back malformed throws away eight good ones. The failure is recorded and the run
          // continues; the user sees a project that is usable and a note naming what was skipped.
          const note = e instanceof KenariError ? e.message : e instanceof Error ? e.message : String(e);
          skipped.push(`${m.title}: ${note}`);
          setJob(projectId, "running", {
            phase: "modules",
            done: i + 1,
            total: plan.length,
            note: `skipped: ${m.title}`,
          });
          continue;
        }
        account(r.meta);

        generated.push({
          slug: uniqueSlug(moduleSlug(i + 1, r.value.title || m.title), usedSlugs),
          position: i + 1,
          title: r.value.title || m.title,
          objective: m.objective,
          files: m.files,
          studyMd: r.value.studyMd,
          questions: r.value.questions,
        });
      }

      // Written after each module, so a crash mid-run leaves what succeeded rather than nothing.
      persistModules(projectId, generated, usedSlugs);
      setJob(projectId, "running", {
        phase: "modules",
        done: i + 1,
        total: plan.length,
        // The LAST generated module, not `generated[i]`: a skipped module makes the array shorter
        // than `i`, and indexing by the plan position then reads past the end.
        note: generated[generated.length - 1]!.title,
      });
    }

    // 4. drop modules the new plan no longer contains, then report the questions phase once so
    // the UI's label matches what happened.
    pruneModules(projectId, usedSlugs);
    setJob(projectId, "running", {
      phase: "questions",
      done: generated.length,
      total: generated.length,
      note: "interview questions written",
    });

    // 5. done. A run that skipped modules is still `ready`: the project is usable, and the skipped
    // ones are named in `error` as a warning rather than a failure. Only a run that produced
    // NOTHING is an error, because then there is no curriculum to show.
    const warning = skipped.length > 0 ? `Skipped ${skipped.length} module(s): ${skipped.join("; ")}` : null;

    if (generated.length === 0) {
      throw new Error(warning ?? "generation produced no modules");
    }

    db.run(
      "UPDATE projects SET status = 'ready', error = ?, generated_at = ?, model = ?, cost_idr = ? WHERE id = ?",
      [warning, new Date().toISOString(), model, costIdr, projectId],
    );
    setJob(projectId, "done", {
      phase: "done",
      done: generated.length,
      total: plan.length,
      note: warning ? `${generated.length}/${plan.length} modules — some skipped` : "ready",
    });
  } catch (e) {
    const message = e instanceof KenariError ? e.message : e instanceof Error ? e.message : String(e);
    db.run("UPDATE projects SET status = 'error', error = ?, model = ?, cost_idr = ? WHERE id = ?", [
      message,
      model,
      costIdr,
      projectId,
    ]);
    const job = db
      .query<{ progress: string }, [number]>("SELECT progress FROM project_jobs WHERE project_id = ?")
      .get(projectId);
    const progress = job
      ? (JSON.parse(job.progress) as GenerationProgress)
      : ({ phase: "scan", done: 0, total: 1, note: "" } as GenerationProgress);
    setJob(projectId, "error", progress, message);
  }
}

/**
 * Re-scan and regenerate, keeping what did not change.
 *
 * A module is identified across regenerations by its FILE SET. When a planned module's files are
 * exactly the files an existing module was generated from, that module is reused verbatim: no
 * model call, and its slug — and therefore its `items` row, `item_cards` row and graded
 * `project_sessions` — survives untouched. Regenerating a project must not silently discard the
 * user's progress on the parts that did not change.
 *
 * The re-scan happens before `runGeneration` so a vanished root fails here, with the error on the
 * project row, rather than after the map call has been paid for.
 */
export async function regenerateProject(projectId: number): Promise<void> {
  const project = readProject(projectId);
  db.run("UPDATE projects SET status = 'running', error = NULL WHERE id = ?", [projectId]);
  setJob(projectId, "running", { phase: "scan", done: 0, total: 1, note: "re-reading the directory" });

  let scan: ScanResult;
  try {
    scan = await scanProject(project.root);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    db.run("UPDATE projects SET status = 'error', error = ? WHERE id = ?", [message, projectId]);
    setJob(projectId, "error", { phase: "scan", done: 0, total: 1, note: "" }, message);
    return;
  }

  const known = new Set(scan.files.map((f) => f.rel));
  const carryOver = new Map<string, ExistingModule[]>();
  for (const row of db
    .query<{ slug: string; title: string; objective: string; files_json: string; study_md: string; questions_json: string }, [number]>(
      `SELECT slug, title, objective, files_json, study_md, questions_json
       FROM project_modules WHERE project_id = ? ORDER BY position`,
    )
    .all(projectId)) {
    const files = JSON.parse(row.files_json) as string[];
    // Only a module whose every file still exists can be carried over. A module that lost a file
    // is regenerated, because its study document describes code that is gone.
    if (files.length === 0 || !files.every((f) => known.has(f))) continue;
    const key = fileSetKey(files);
    const bucket = carryOver.get(key) ?? [];
    bucket.push({
      slug: row.slug,
      title: row.title,
      objective: row.objective,
      studyMd: row.study_md,
      questions: JSON.parse(row.questions_json) as Question[],
    });
    carryOver.set(key, bucket);
  }

  await runGeneration(projectId, carryOver);
}

/**
 * Remove module rows the latest run no longer produced.
 *
 * Their `items`/`item_cards` rows go too: a module the curriculum dropped must not keep coming
 * back in the review queue. `items.ref` is `<projectSlug>/<moduleSlug>`, so the composite is
 * deleted by prefix.
 */
function pruneModules(projectId: number, usedSlugs: Set<string>): void {
  const project = db.query<{ slug: string }, [number]>("SELECT slug FROM projects WHERE id = ?").get(projectId);
  if (!project) return;
  const rows = db
    .query<{ slug: string }, [number]>("SELECT slug FROM project_modules WHERE project_id = ?")
    .all(projectId);
  const stale = rows.map((r) => r.slug).filter((s) => !usedSlugs.has(s));
  if (stale.length === 0) return;

  db.transaction(() => {
    for (const slug of stale) {
      const ref = `${project.slug}/${slug}`;
      db.run("DELETE FROM item_cards WHERE item_id IN (SELECT id FROM items WHERE kind = 'project' AND ref = ?)", [ref]);
      db.run("DELETE FROM items WHERE kind = 'project' AND ref = ?", [ref]);
      db.run("DELETE FROM project_modules WHERE project_id = ? AND slug = ?", [projectId, slug]);
    }
  })();
}

/**
 * Write the generated modules for a project.
 *
 * Called after each module so partial progress survives a crash, so it upserts rather than
 * truncating: a `DELETE`-then-insert would drop the earlier modules each time. Rows whose slug is
 * no longer in the plan are removed at the end of the run by `pruneModules`.
 */
function persistModules(projectId: number, modules: GeneratedModule[], usedSlugs: Set<string>): void {
  db.transaction(() => {
    const insert = db.query(
      `INSERT INTO project_modules
         (project_id, slug, position, title, objective, files_json, study_md, questions_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, slug) DO UPDATE SET
         position = excluded.position, title = excluded.title, objective = excluded.objective,
         files_json = excluded.files_json, study_md = excluded.study_md,
         questions_json = excluded.questions_json`,
    );
    for (const m of modules) {
      insert.run(
        projectId,
        m.slug,
        m.position,
        m.title,
        m.objective,
        JSON.stringify(m.files),
        m.studyMd,
        JSON.stringify(m.questions),
      );
      usedSlugs.add(m.slug);
    }
  })();
}
