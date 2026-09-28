-- Reset support and app settings.
--
-- No schema change is required for either: `meta` already exists as a key/value store, so
-- the API key lives there, and the reset endpoint only DELETEs from tables that already
-- exist. This file exists so the feature has a migration boundary.
--
-- It must still contain a statement. Bun's `db.exec` rejects a comment-only script with
-- "Query contained no valid SQL statement", which would abort the migration and leave it
-- recorded as unapplied.
SELECT 1;
