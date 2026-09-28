-- Executable system-design components. Same shape as `concept_exercises` — one row per
-- (lang, slug) — but a separate table because the module vocabulary differs and the op
-- encoding needs its own column.
CREATE TABLE IF NOT EXISTS component_exercises (
  id          INTEGER PRIMARY KEY,
  lang        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  module      TEXT NOT NULL,
  title       TEXT NOT NULL,
  concept_md  TEXT NOT NULL,
  prompt_md   TEXT NOT NULL,
  op_format   TEXT NOT NULL,
  starter     TEXT NOT NULL,
  solution    TEXT NOT NULL,
  fn_name     TEXT NOT NULL,
  tests       TEXT NOT NULL,
  prereq      TEXT,
  UNIQUE (lang, slug)
);

CREATE INDEX IF NOT EXISTS idx_components_lang_module ON component_exercises(lang, module);
