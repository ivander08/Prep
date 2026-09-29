-- The sketch pad's shapes, as JSON, so a reloaded round is both visible and still editable.
--
-- Replaces `sketch_png`, which was a rasterised copy written on every gesture and read by
-- nothing: a reload restored the phase drafts and left the pad empty. The source of truth is the
-- shape list, which can be re-rendered and re-edited; a bitmap cannot.
--
-- `sketch_png` held no data any code could read, so dropping it loses nothing reachable.

ALTER TABLE design_sessions ADD COLUMN sketch_shapes TEXT;
ALTER TABLE design_sessions DROP COLUMN sketch_png;
