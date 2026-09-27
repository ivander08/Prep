-- Tutor turns can happen before any attempt exists — opening the tutor on a fresh problem
-- is the most common first interaction, and it is exactly the case worth auditing (it is
-- where an injection attempt would land). The original NOT NULL constraint made those
-- turns unrecordable, so the insert failed with a constraint error.
--
-- SQLite cannot drop NOT NULL in place; the table is rebuilt.

CREATE TABLE IF NOT EXISTS tutor_turns_new (
  id                INTEGER PRIMARY KEY,
  attempt_id        INTEGER REFERENCES attempts(id) ON DELETE CASCADE,
  ts                TEXT NOT NULL,
  ceiling           INTEGER NOT NULL,
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

INSERT INTO tutor_turns_new
  SELECT id, attempt_id, ts, ceiling, emitted_level, contains_solution, contains_real_code,
         rejected, reject_reason, message, model, tokens_in, tokens_out, cost_idr
  FROM tutor_turns;

DROP TABLE tutor_turns;

ALTER TABLE tutor_turns_new RENAME TO tutor_turns;

CREATE INDEX IF NOT EXISTS idx_turns_attempt ON tutor_turns(attempt_id);
CREATE INDEX IF NOT EXISTS idx_turns_ts ON tutor_turns(ts);
