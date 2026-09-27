-- `pattern_mastery` was created in 001 with (pattern, elo, attempts, solved, updated_at).
-- The mastery engine also needs the hint rate per pattern, since passing after hints is
-- weaker evidence than passing unaided and the weakness view reports it.

ALTER TABLE pattern_mastery ADD COLUMN hint_rate REAL NOT NULL DEFAULT 0;
