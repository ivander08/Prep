-- Full test suites, imported from a public dataset.
--
-- LeetCode's GraphQL API exposes only `exampleTestcases` — the 2-3 public examples. A
-- solution that passes locally can therefore still fail LeetCode's hidden tests, and the
-- UI has to warn about it.
--
-- `newfacade/LeetCodeDataset` (Apache-2.0) closes most of that gap: ~2,869 problems with
-- 37-144 *executable* assertions each, in human-eval format (`entry_point` + `check()`).
-- Verified by running one: the dataset's own reference solution passes its own tests.
--
-- `entry_point` is a dotted path like `Solution().shortestDistanceAfterQueries`, which
-- binds exactly the way the executor already calls user code.
--
-- These are third-party tests, not LeetCode's. They are a much better proxy than the
-- public examples, but they are not authoritative, and the UI says so.

CREATE TABLE IF NOT EXISTS full_tests (
  slug        TEXT PRIMARY KEY,
  question_id TEXT,
  entry_point TEXT NOT NULL,
  -- The dataset's `prompt` block: imports + a `ListNode`/`TreeNode` prelude that some
  -- problems need. Must be prepended before user code or those problems fail to run.
  prelude     TEXT NOT NULL,
  -- The `check(candidate)` function body, containing every assertion.
  test_body   TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'newfacade/LeetCodeDataset',
  imported_at TEXT NOT NULL
);
