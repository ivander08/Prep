/**
 * Project learning: reads and the session lifecycle.
 *
 * Mirrors `concepts.ts` (seed → list → get → run → record), minus the executor: a module is not
 * executed, it is read and then answered in prose. The grade goes through the SAME prose grader the
 * behavioral and stack tracks use (`gradeProseAnswer`), with the module's study document supplied
 * as reference material, and the resulting grade schedules the module through `reviewProject`.
 *
 * The module's identity in `items` is the composite `<projectSlug>/<moduleSlug>`, so a due row's
 * `ref` carries both halves and `ProjectsView` can open the right module without an id lookup.
 */

import type { Grade } from "ts-fsrs";
import { db } from "./db.ts";
import { gradeProseAnswer, type TrackGradeResult } from "./tracks/grade.ts";
import { reviewProject } from "./srs.ts";
import type { GenerationProgress } from "./project/generate.ts";
import type { ScanSummary } from "./project/scan.ts";
import type { Question } from "./project/generate.ts";

export type ProjectStatus = "running" | "ready" | "error";

export type ProjectSummary = {
  id: number;
  slug: string;
  name: string;
  root: string;
  status: ProjectStatus;
  error: string | null;
  createdAt: string;
  generatedAt: string | null;
  modules: number;
  learned: number;
};

export type ProjectModule = {
  id: number;
  projectId: number;
  slug: string;
  position: number;
  title: string;
  objective: string;
  files: string[];
  studyMd: string;
  questions: Question[];
};

export type ProjectModuleDetail = ProjectModule & { learned: boolean; lastGrade: number | null };

export type ProjectDetail = {
  project: ProjectSummary;
  stack: string[];
  scan: ScanSummary | null;
  modules: ProjectModuleDetail[];
  job: (GenerationProgress & { status: string }) | null;
};

export type ProjectSessionView = {
  id: number;
  projectId: number;
  moduleSlug: string;
  question: string;
  answerMd: string;
  startedAt: string;
  endedAt: string | null;
  grade: number | null;
};

type ProjectRow = {
  id: number;
  slug: string;
  name: string;
  root: string;
  status: string;
  error: string | null;
  created_at: string;
  generated_at: string | null;
  stack: string | null;
  scan_json: string | null;
};

type ModuleRow = {
  id: number;
  project_id: number;
  slug: string;
  position: number;
  title: string;
  objective: string;
  files_json: string;
  study_md: string;
  questions_json: string;
  /** 1 when an `item_cards` row exists for this module, i.e. it has been graded and scheduled. */
  learned: number;
  last_grade: number | null;
};

/**
 * The module select, with its learned marker.
 *
 * `learned` is computed exactly the way `concepts.ts` computes `reviewed`: the presence of an
 * `item_cards` row for the matching `items` row. `items.ref` is the composite, built from the
 * project's slug and the module's slug, so the join is a string concatenation rather than a
 * second table.
 *
 * `last_grade` reads the newest graded session for the module, which is what the UI shows as the
 * module's last result.
 */
const MODULE_SELECT = `
  SELECT m.id, m.project_id, m.slug, m.position, m.title, m.objective, m.files_json,
         m.study_md, m.questions_json,
         CASE WHEN EXISTS (
           SELECT 1 FROM item_cards ic
           JOIN items i ON i.id = ic.item_id
           WHERE i.kind = 'project' AND i.ref = p.slug || '/' || m.slug
         ) THEN 1 ELSE 0 END AS learned,
         (SELECT s.grade FROM project_sessions s
          WHERE s.project_id = m.project_id AND s.module_slug = m.slug AND s.ended_at IS NOT NULL
          ORDER BY s.ended_at DESC LIMIT 1) AS last_grade
  FROM project_modules m
  JOIN projects p ON p.id = m.project_id
`;

function toModule(r: ModuleRow): ProjectModuleDetail {
  return {
    id: r.id,
    projectId: r.project_id,
    slug: r.slug,
    position: r.position,
    title: r.title,
    objective: r.objective,
    files: JSON.parse(r.files_json) as string[],
    studyMd: r.study_md,
    questions: JSON.parse(r.questions_json) as Question[],
    learned: r.learned === 1,
    lastGrade: r.last_grade,
  };
}

function toSummary(r: ProjectRow): ProjectSummary {
  const counts = db
    .query<{ modules: number; learned: number }, [number, number, string]>(
      `SELECT
         (SELECT COUNT(*) FROM project_modules WHERE project_id = ?) AS modules,
         (SELECT COUNT(*) FROM project_modules m
           WHERE m.project_id = ?
             AND EXISTS (
               SELECT 1 FROM item_cards ic JOIN items i ON i.id = ic.item_id
               WHERE i.kind = 'project' AND i.ref = ? || '/' || m.slug
             )) AS learned`,
    )
    .get(r.id, r.id, r.slug);

  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    root: r.root,
    status: (r.status as ProjectStatus) ?? "running",
    error: r.error,
    createdAt: r.created_at,
    generatedAt: r.generated_at,
    modules: counts?.modules ?? 0,
    learned: counts?.learned ?? 0,
  };
}

/** Every imported project, newest first. */
export function listProjects(): ProjectSummary[] {
  const rows = db
    .query<ProjectRow, []>(
      `SELECT id, slug, name, root, status, error, created_at, generated_at, stack, scan_json
       FROM projects ORDER BY id DESC`,
    )
    .all();
  return rows.map(toSummary);
}

/** One project with its modules, stack, scan summary and job state. Null when unknown. */
export function getProject(id: number): ProjectDetail | null {
  const row = db
    .query<ProjectRow, [number]>(
      `SELECT id, slug, name, root, status, error, created_at, generated_at, stack, scan_json
       FROM projects WHERE id = ?`,
    )
    .get(id);
  if (!row) return null;

  const modules = db
    .query<ModuleRow, [number]>(`${MODULE_SELECT} WHERE m.project_id = ? ORDER BY m.position`)
    .all(id)
    .map(toModule);

  const jobRow = db
    .query<{ status: string; progress: string }, [number]>(
      "SELECT status, progress FROM project_jobs WHERE project_id = ?",
    )
    .get(id);

  return {
    project: toSummary(row),
    stack: row.stack ? (JSON.parse(row.stack) as string[]) : [],
    scan: row.scan_json ? (JSON.parse(row.scan_json) as ScanSummary) : null,
    modules,
    job: jobRow
      ? { ...(JSON.parse(jobRow.progress) as GenerationProgress), status: jobRow.status }
      : null,
  };
}

/** One module, with its learned marker. Null when the project or the slug is unknown. */
export function getProjectModule(projectId: number, slug: string): ProjectModuleDetail | null {
  const row = db
    .query<ModuleRow, [number, string]>(`${MODULE_SELECT} WHERE m.project_id = ? AND m.slug = ?`)
    .get(projectId, slug);
  return row ? toModule(row) : null;
}

/**
 * The module's study document as the grader sees it.
 *
 * `study_md` carries the six required `##` sections, including `Key files` and `How it fits` with
 * their `rel:line` citations, so it is a faithful reference for what the module covers and needs no
 * second rendering.
 */
export function generateModuleStudy(projectId: number, slug: string): string | null {
  const row = db
    .query<{ study_md: string }, [number, string]>(
      "SELECT study_md FROM project_modules WHERE project_id = ? AND slug = ?",
    )
    .get(projectId, slug);
  return row?.study_md ?? null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

type SessionRow = {
  id: number;
  project_id: number;
  module_slug: string;
  question: string;
  answer_md: string;
  started_at: string;
  ended_at: string | null;
  scores: string | null;
  grade: number | null;
  model: string | null;
  cost_idr: number | null;
};

function toSession(r: SessionRow): ProjectSessionView {
  return {
    id: r.id,
    projectId: r.project_id,
    moduleSlug: r.module_slug,
    question: r.question,
    answerMd: r.answer_md,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    grade: r.grade,
  };
}

function readSession(id: number): SessionRow {
  const row = db.query<SessionRow, [number]>("SELECT * FROM project_sessions WHERE id = ?").get(id);
  if (!row) throw new Error(`unknown project session: ${id}`);
  return row;
}

/**
 * Start (or resume) a session for one question of a module.
 *
 * Refuses a question that is not in the module's `questions_json`: the question is the prompt and
 * the answer key is stored with it, so a question the module does not contain has no key to grade
 * against.
 *
 * Resumes the latest open session for that module when one exists, mirroring
 * `latestOpenTrackSession`: a reload must land back on the work rather than on an empty prompt.
 * The resume is scoped to the module, not to the question, so an answer already in progress is not
 * orphaned by switching questions and back.
 */
export function startModuleSession(projectId: number, slug: string, question: string): number {
  const module = getProjectModule(projectId, slug);
  if (!module) throw new Error(`unknown module: ${slug}`);
  if (!module.questions.some((q) => q.q === question)) {
    throw new Error("that question is not part of this module");
  }

  const open = db
    .query<{ id: number }, [number, string, string]>(
      `SELECT id FROM project_sessions
       WHERE project_id = ? AND module_slug = ? AND question = ? AND ended_at IS NULL
       ORDER BY id DESC LIMIT 1`,
    )
    .get(projectId, slug, question);
  if (open) return open.id;

  db.run(
    "INSERT INTO project_sessions (project_id, module_slug, question, started_at) VALUES (?, ?, ?, ?)",
    [projectId, slug, question, new Date().toISOString()],
  );
  return db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
}

/** Persist the answer draft, so a reload does not lose work. */
export function saveModuleAnswer(sessionId: number, answerMd: string): void {
  readSession(sessionId);
  db.run("UPDATE project_sessions SET answer_md = ? WHERE id = ?", [answerMd, sessionId]);
}

/** The session row for the UI. Null when unknown. */
export function loadModuleSession(sessionId: number): ProjectSessionView | null {
  const row = db.query<SessionRow, [number]>("SELECT * FROM project_sessions WHERE id = ?").get(sessionId);
  return row ? toSession(row) : null;
}

/**
 * The most recent unfinished session of a project, if any.
 *
 * The design round's rule: a session with work in it, not merely the newest open row, so clicking
 * through questions does not resume an empty click.
 */
export function latestOpenProjectSession(projectId: number): ProjectSessionView | null {
  const row = db
    .query<{ id: number }, [number]>(
      `SELECT id FROM project_sessions
       WHERE project_id = ? AND ended_at IS NULL AND answer_md <> ''
       ORDER BY id DESC LIMIT 1`,
    )
    .get(projectId);
  return row ? loadModuleSession(row.id) : null;
}

/**
 * Grade a finished answer and schedule the module.
 *
 * The model call happens OUTSIDE any transaction and the `UPDATE` is a separate synchronous
 * `db.transaction`, the same order `finishTrackSession` uses: `bun:sqlite` transactions are
 * synchronous, so awaiting inside one is a bug.
 *
 * The session is marked graded only after the model returns, so a grading failure leaves the answer
 * intact and resubmittable. Only an answer that cleared the bottom band is scheduled; a grade of 1
 * is reported and not scheduled.
 */
export async function finishModuleSession(
  sessionId: number,
): Promise<TrackGradeResult & { nextDue: string | null; intervalDays: number | null }> {
  const row = readSession(sessionId);
  if (row.ended_at !== null) throw new Error("session already graded");

  const module = getProjectModule(row.project_id, row.module_slug);
  if (!module) throw new Error(`unknown module: ${row.module_slug}`);
  const question = module.questions.find((q) => q.q === row.question);
  if (!question) throw new Error("that question is not part of this module");

  const project = db
    .query<{ slug: string }, [number]>("SELECT slug FROM projects WHERE id = ?")
    .get(row.project_id);
  if (!project) throw new Error(`unknown project: ${row.project_id}`);

  const result = await gradeProseAnswer({
    kind: "project",
    title: module.title,
    statement: question.q,
    lookFor: question.lookFor,
    commonMistakes: question.commonMistakes,
    reference: generateModuleStudy(row.project_id, row.module_slug) ?? "",
    answer: row.answer_md,
  });

  db.transaction(() => {
    db.run(
      "UPDATE project_sessions SET scores = ?, grade = ?, model = ?, cost_idr = ?, ended_at = ? WHERE id = ?",
      [
        JSON.stringify(result.scores),
        result.grade,
        result.model,
        result.costIdr,
        new Date().toISOString(),
        sessionId,
      ],
    );
  })();

  if (result.grade <= 1) return { ...result, nextDue: null, intervalDays: null };

  const s = reviewProject(project.slug, module.slug, module.title, result.grade as Grade);
  return { ...result, nextDue: s.due.toISOString(), intervalDays: s.intervalDays };
}

/**
 * Delete a project and everything derived from it.
 *
 * The `items` rows of kind `project` are deleted explicitly, and this is required: `POST /api/reset`
 * deletes `item_cards` but not `items`, and a stale `items` row would otherwise resurface in the
 * review queue on the next pass. Deleting the project row cascades its modules, job and sessions.
 */
export function deleteProject(id: number): void {
  const row = db.query<{ slug: string }, [number]>("SELECT slug FROM projects WHERE id = ?").get(id);
  if (!row) throw new Error(`unknown project: ${id}`);

  db.transaction(() => {
    db.run(
      "DELETE FROM item_cards WHERE item_id IN (SELECT id FROM items WHERE kind = 'project' AND ref LIKE ?)",
      [`${row.slug}/%`],
    );
    db.run("DELETE FROM items WHERE kind = 'project' AND ref LIKE ?", [`${row.slug}/%`]);
    db.run("DELETE FROM projects WHERE id = ?", [id]);
  })();
}
