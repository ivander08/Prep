-- Pre-DSA language fundamentals.
--
-- One row per (language, concept). Graded by the existing executor and scheduled through the
-- `items` + `item_cards` tables, which were created in 001 with a `kind='concept'` comment
-- and have been unused since — this is what they were reserved for.
--
-- `solution` is an exemplar that MUST pass its own `tests`. That is enforced, not asserted:
-- concepts.test.ts runs every seeded exemplar through the executor and fails if any does
-- not, which is what makes generating the content trustworthy.
CREATE TABLE IF NOT EXISTS concept_exercises (
  id         INTEGER PRIMARY KEY,
  lang       TEXT NOT NULL,     -- python3 | javascript | java | cpp | go
  slug       TEXT NOT NULL,     -- 'python3/2d-array-init'
  module     TEXT NOT NULL,     -- collections | strings | matrix | sorting | idioms | pitfalls
  title      TEXT NOT NULL,
  concept_md TEXT NOT NULL,     -- <= 120 words: the worked example
  prompt_md  TEXT NOT NULL,     -- what to do
  starter    TEXT NOT NULL,     -- faded scaffold
  solution   TEXT NOT NULL,     -- exemplar; MUST pass its own tests
  fn_name    TEXT NOT NULL,
  tests      TEXT NOT NULL,     -- JSON [{args, expected}]
  prereq     TEXT,              -- comma-joined slugs
  UNIQUE (lang, slug)
);

CREATE INDEX IF NOT EXISTS idx_concepts_lang_module ON concept_exercises(lang, module);
