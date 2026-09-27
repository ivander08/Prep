-- The mastery engine also tracks lapses per pattern: a re-solve failure on a problem you
-- previously solved is the strongest negative signal available (the "memorized it, did not
-- learn it" case), so it is stored rather than recomputed on read.
--
-- `hint_rate` arrived in 004; `lapses` was missed there because a grep for the column name
-- matched the `cards` and `item_cards` tables instead.

ALTER TABLE pattern_mastery ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0;
