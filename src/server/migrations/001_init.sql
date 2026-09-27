-- Catalog: every LeetCode problem. Populated by ingest.ts.
CREATE TABLE IF NOT EXISTS problems (
  qid          INTEGER PRIMARY KEY,   -- questionFrontendId
  slug         TEXT UNIQUE NOT NULL,  -- titleSlug, the join key across all sources
  title        TEXT NOT NULL,
  difficulty   TEXT NOT NULL,         -- Easy | Medium | Hard
  paid_only    INTEGER NOT NULL DEFAULT 0,
  ac_rate      REAL,
  topics       TEXT,                  -- comma-joined topic slugs
  -- Lazily fetched on first open, then cached forever.
  statement_md TEXT,
  hints        TEXT,                  -- JSON array of official hints
  snippets     TEXT,                  -- JSON { langSlug: code }
  meta_json    TEXT,                  -- metaData: typed params, drives the harness
  examples     TEXT,                  -- raw exampleTestcases blob
  fetched_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_problems_difficulty ON problems(difficulty);
CREATE INDEX IF NOT EXISTS idx_problems_paid ON problems(paid_only);

-- Curated list membership. One row per (list, problem).
CREATE TABLE IF NOT EXISTS lists (
  name     TEXT NOT NULL,             -- blind75 | neetcode150 | neetcode250 | neetcodeAll
  qid      INTEGER NOT NULL,          -- leetcode75 | topInterview150 | sql50
  position INTEGER NOT NULL,
  PRIMARY KEY (name, qid)
);

CREATE INDEX IF NOT EXISTS idx_lists_name_pos ON lists(name, position);

-- DSA review state. One card per problem. Graded from EXECUTION OUTCOME, not self-report.
CREATE TABLE IF NOT EXISTS cards (
  qid            INTEGER PRIMARY KEY REFERENCES problems(qid) ON DELETE CASCADE,
  due            TEXT NOT NULL,
  stability      REAL,
  difficulty     REAL,
  elapsed_days   REAL,
  scheduled_days INTEGER,
  reps           INTEGER NOT NULL DEFAULT 0,
  lapses         INTEGER NOT NULL DEFAULT 0,
  state          INTEGER NOT NULL DEFAULT 0,
  last_review    TEXT,
  suspended      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due) WHERE suspended = 0;

-- Every solve attempt. The raw material for grading and analytics.
CREATE TABLE IF NOT EXISTS attempts (
  id                INTEGER PRIMARY KEY,
  qid               INTEGER NOT NULL REFERENCES problems(qid) ON DELETE CASCADE,
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  passed            INTEGER,          -- NULL = abandoned
  tests_passed      INTEGER,
  tests_total       INTEGER,
  hints_used        INTEGER NOT NULL DEFAULT 0,
  max_hint_level    INTEGER NOT NULL DEFAULT 0,
  solution_unlocked INTEGER NOT NULL DEFAULT 0,
  seconds           REAL,
  code              TEXT,
  language          TEXT NOT NULL DEFAULT 'python3',
  grade             INTEGER           -- 1..4, DERIVED by gradeAttempt(); never asked
);

CREATE INDEX IF NOT EXISTS idx_attempts_qid ON attempts(qid, started_at DESC);

-- One row per hint-ladder turn. This is the honest-mode audit trail.
CREATE TABLE IF NOT EXISTS tutor_turns (
  id                INTEGER PRIMARY KEY,
  attempt_id        INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  ts                TEXT NOT NULL,
  ceiling           INTEGER NOT NULL,  -- computed by policy.ts from state only
  emitted_level     INTEGER,
  contains_solution INTEGER,
  contains_real_code INTEGER,
  rejected          INTEGER NOT NULL DEFAULT 0,
  reject_reason     TEXT,
  message           TEXT,
  model             TEXT,
  tokens_in         INTEGER,
  tokens_out        INTEGER,
  cost_idr          REAL
);

CREATE INDEX IF NOT EXISTS idx_turns_attempt ON tutor_turns(attempt_id);

-- Per-pattern skill estimate. Patterns are the 18 roadmap categories.
CREATE TABLE IF NOT EXISTS pattern_mastery (
  pattern    TEXT PRIMARY KEY,
  elo        REAL NOT NULL DEFAULT 1200,
  attempts   INTEGER NOT NULL DEFAULT 0,
  solved     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

-- Non-DSA study items (hld | behavioral | stack | sql | concept).
CREATE TABLE IF NOT EXISTS items (
  id       INTEGER PRIMARY KEY,
  kind     TEXT NOT NULL,
  ref      TEXT NOT NULL,
  title    TEXT NOT NULL,
  body_md  TEXT,
  UNIQUE (kind, ref)
);

-- Review state for non-DSA items. Separate table from `cards` on purpose:
-- DSA review is driven by execution outcome, this is driven by self-rating.
-- Conflating the two is what makes other tools' SRS feel wrong.
CREATE TABLE IF NOT EXISTS item_cards (
  item_id     INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  due         TEXT NOT NULL,
  stability   REAL,
  difficulty  REAL,
  reps        INTEGER NOT NULL DEFAULT 0,
  lapses      INTEGER NOT NULL DEFAULT 0,
  state       INTEGER NOT NULL DEFAULT 0,
  last_review TEXT
);

CREATE INDEX IF NOT EXISTS idx_item_cards_due ON item_cards(due);

-- Free-form key/value: last ingest time, schema version, UI prefs.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
