-- Phase 3: pattern mapping, company tags, and user-selected models.

-- The NeetCode roadmap category a problem belongs to. Distinct from LeetCode's own topic
-- tags: `topics` is a flat set (array, hash-table), while `pattern` is the single
-- technique family the roadmap teaches (Arrays & Hashing, Sliding Window, ...). Mastery is
-- tracked per pattern because patterns transfer and individual problems do not.
ALTER TABLE problems ADD COLUMN pattern TEXT;

CREATE INDEX IF NOT EXISTS idx_problems_pattern ON problems(pattern);

-- Company → problem, with an ask-frequency score. Sourced from
-- liquidslr/leetcode-company-wise-problems (470 companies). Joined on the LeetCode slug
-- from the CSV's Link column, not on title — titles differ in punctuation and casing.
CREATE TABLE IF NOT EXISTS company_problems (
  company   TEXT NOT NULL,
  qid       INTEGER NOT NULL REFERENCES problems(qid) ON DELETE CASCADE,
  frequency REAL,
  PRIMARY KEY (company, qid)
);

CREATE INDEX IF NOT EXISTS idx_company_freq ON company_problems(company, frequency DESC);
CREATE INDEX IF NOT EXISTS idx_company_qid ON company_problems(qid);

-- Model roles the user can point at any model in the catalog. Absent rows fall back to
-- the built-in chain in client.ts.
CREATE TABLE IF NOT EXISTS model_roles (
  role     TEXT PRIMARY KEY,   -- tutor | review | ingest
  model    TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
