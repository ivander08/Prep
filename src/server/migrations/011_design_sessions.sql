-- System design practice rounds.
--
-- One row per attempt at a design prompt. `transcript` is the full ordered exchange; the
-- per-phase drafts live inside it rather than in columns because a phase can be revised any
-- number of times and only the final text is graded.
--
-- `probe_level` records the deepest probe family the interviewer reached. It is computed by
-- a deterministic ladder (see `design/policy.ts`) and stored so the audit trail shows what
-- the candidate was actually asked, not just what they answered.

CREATE TABLE IF NOT EXISTS design_sessions (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  -- Serialised phase drafts: {"requirements": "...", "estimation": "...", ...}
  drafts        TEXT NOT NULL DEFAULT '{}',
  -- Ordered [{role, text, ts}] — the graded artifact.
  transcript    TEXT NOT NULL DEFAULT '[]',
  -- Base64 PNG of the sketch pad, if anything was drawn. Null is normal.
  sketch_png    TEXT,
  probe_level   INTEGER NOT NULL DEFAULT 0,
  seconds       REAL,
  -- Rubric scores, written once at the end. Null until graded.
  scores        TEXT,
  grade         INTEGER,
  model         TEXT,
  cost_idr      REAL
);

CREATE INDEX IF NOT EXISTS idx_design_sessions_slug ON design_sessions(slug, started_at DESC);
