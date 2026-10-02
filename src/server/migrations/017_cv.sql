-- ATS-friendly CV documents.
--
-- `doc_json` holds the whole `CvDoc`. The `.tex` is rendered in memory on demand and the compiled
-- PDF is cached in the `meta` table, never stored here: the document stays the single source of
-- truth, and a template fix applies to every saved CV on the next render instead of leaving a
-- stale PDF beside it.
--
-- `jd` is the pasted job description, kept so the keyword coverage can be recomputed without the
-- user pasting it again.
CREATE TABLE IF NOT EXISTS cv_documents (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  doc_json   TEXT NOT NULL,
  jd         TEXT NOT NULL DEFAULT '',
  model      TEXT,
  cost_idr   REAL
);
