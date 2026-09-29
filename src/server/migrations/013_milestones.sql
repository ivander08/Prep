-- Earned-once milestones.
--
-- Only earned rows are stored: the definitions live in `src/server/milestones.ts` as code,
-- matching how every other catalogue in this project is held, so editing a title or a
-- requirement is a source edit and not a migration. A row's presence IS the award, and
-- `earned_at` is when the condition was first observed true — which is why the table has no
-- `progress` column: progress is recomputed on read and never stored.
CREATE TABLE IF NOT EXISTS milestones (
  id        TEXT PRIMARY KEY,
  earned_at TEXT NOT NULL
);
