-- Project learning: import a project directory, generate a curriculum from its source.
--
-- Four tables, all user progress: `projects` is the imported project, `project_modules` the
-- ordered curriculum generated from its files, `project_jobs` the one-row-per-project generation
-- status the UI polls, and `project_sessions` one row per graded interview answer.
--
-- `scan_json` holds the scan SUMMARY (paths, sizes, per-language counts), never the file text:
-- the source belongs to the user and is read from disk on demand, not copied into the database.
-- `study_md` and `questions_json` are generated once per module and are the curriculum.
--
-- `project_sessions.scores` is written once at grading, like `track_sessions.scores`; the grade
-- it produces schedules the module through `item_cards` with `kind = 'project'` and
-- `ref = <project slug>/<module slug>`.
CREATE TABLE IF NOT EXISTS projects (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  root         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  generated_at TEXT,
  status       TEXT NOT NULL DEFAULT 'running',   -- running | ready | error
  error        TEXT,
  stack        TEXT,                              -- JSON string[]
  scan_json    TEXT,                              -- ScanSummary: no file text
  model        TEXT,
  cost_idr     REAL
);

CREATE TABLE IF NOT EXISTS project_modules (
  id             INTEGER PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL,
  position       INTEGER NOT NULL,
  title          TEXT NOT NULL,
  objective      TEXT NOT NULL DEFAULT '',
  files_json     TEXT NOT NULL DEFAULT '[]',
  study_md       TEXT NOT NULL DEFAULT '',
  questions_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE (project_id, slug)
);

CREATE TABLE IF NOT EXISTS project_jobs (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  progress   TEXT NOT NULL DEFAULT '{}',
  error      TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_sessions (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_slug TEXT NOT NULL,
  question    TEXT NOT NULL,
  answer_md   TEXT NOT NULL DEFAULT '',
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  scores      TEXT,
  grade       INTEGER,
  model       TEXT,
  cost_idr    REAL
);

CREATE INDEX IF NOT EXISTS idx_project_sessions_module
  ON project_sessions(project_id, module_slug, started_at DESC);
