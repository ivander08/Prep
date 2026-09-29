-- Prose-answer sessions for the stack and behavioral tracks.
--
-- One row per attempt at a prompt. `scores` is written once at the end, like
-- `design_sessions.scores`; the grade it produces schedules the item through `item_cards`
-- with `kind` = this row's `kind`, so the two tracks need no review state of their own.
--
-- `answer_md` is a single column rather than the design round's per-phase `drafts` JSON,
-- because a prose prompt has one answer and not five phases. The draft is persisted on blur
-- so a reload lands back on the work, the same way `/api/design/:id/draft` does.
CREATE TABLE IF NOT EXISTS track_sessions (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL,     -- behavioral | stack
  slug       TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  answer_md  TEXT NOT NULL DEFAULT '',
  scores     TEXT,              -- JSON, written once at grading
  grade      INTEGER,
  model      TEXT,
  cost_idr   REAL
);

CREATE INDEX IF NOT EXISTS idx_track_sessions_kind ON track_sessions(kind, slug, started_at DESC);
