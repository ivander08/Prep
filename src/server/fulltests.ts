/**
 * Import full test suites from `newfacade/LeetCodeDataset`.
 *
 * WHY THIS EXISTS
 * LeetCode's GraphQL API exposes only `exampleTestcases` — the 2-3 public examples. A
 * solution that passes locally can still fail LeetCode's hidden tests, and until now the
 * UI had to warn about exactly that. This closes most of the gap.
 *
 * WHAT THE DATASET ACTUALLY CONTAINS (verified by running it, not by reading its README):
 *   - ~2,869 LeetCode problems, one JSON object per line
 *   - 37-144 executable `assert candidate(...) == expected` statements each
 *   - `entry_point` as a dotted path, e.g. `Solution().shortestDistanceAfterQueries`
 *   - a `prompt` block carrying imports and a ListNode/TreeNode prelude
 *   - Apache-2.0
 * Sampling 11 records: every `task_id` joined to our catalog by slug (11/11), and running
 * the dataset's own reference solution against its own tests passed cleanly.
 *
 * IMPORTANT CAVEAT, surfaced in the UI: these are third-party tests. They are a far better
 * proxy than the public examples, but they are not LeetCode's own and not authoritative.
 */

import { db, migrate, setMeta } from "./db.ts";

const BASE = "https://huggingface.co/datasets/newfacade/LeetCodeDataset/resolve/main";
const SPLITS = ["LeetCodeDataset-test.jsonl", "LeetCodeDataset-train.jsonl"];

type IoPair = { input: string; output: string };

type Record = {
  task_id: string;
  question_id: string;
  entry_point: string;
  prompt: string;
  test: string;
  /** Already a parsed array of {input, output} in the dataset JSON. */
  input_output?: IoPair[] | string;
};

/**
 * The dataset repeats `assert candidate(...)` many times per problem, so a single record
 * can be tens of kilobytes. Records are processed one line at a time and never accumulated
 * — the train split alone is 93.6 MB.
 */
async function* streamJsonl(url: string): AsyncGenerator<Record> {
  const res = await fetch(url, {
    headers: { "User-Agent": "prep-local/0.1" },
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  if (!res.body) throw new Error(`${url} → no body`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.startsWith("{")) {
        try {
          yield JSON.parse(line) as Record;
        } catch {
          // A malformed line is skipped rather than aborting a 100 MB import.
        }
      }
      newline = buffer.indexOf("\n");
    }
  }

  const tail = buffer.trim();
  if (tail.startsWith("{")) {
    try {
      yield JSON.parse(tail) as Record;
    } catch {
      // trailing partial line
    }
  }
}

export async function ingestFullTests(): Promise<{ imported: number; matched: number }> {
  migrate();

  const known = new Set(
    db.query<{ slug: string }, []>("SELECT slug FROM problems").all().map((r) => r.slug),
  );

  const insert = db.query(
    `INSERT INTO full_tests (slug, question_id, entry_point, prelude, test_body, io_cases, source, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, 'newfacade/LeetCodeDataset', ?)
     ON CONFLICT(slug) DO UPDATE SET
       entry_point = excluded.entry_point, prelude = excluded.prelude,
       test_body = excluded.test_body, io_cases = excluded.io_cases,
       imported_at = excluded.imported_at`,
  );

  let imported = 0;
  let matched = 0;
  const now = new Date().toISOString();
  let pending: Array<[string, string, string, string, string, string | null, string]> = [];

  const flush = () => {
    if (pending.length === 0) return;
    db.transaction(() => {
      for (const row of pending) insert.run(...row);
    })();
    pending = [];
  };

  for (const split of SPLITS) {
    const url = `${BASE}/${split}`;
    console.log(`[tests] streaming ${split}…`);
    let seen = 0;

    for await (const rec of streamJsonl(url)) {
      seen++;
      if (!rec.task_id || !rec.entry_point || !rec.test) continue;
      imported++;

      // Only store tests for problems we actually have, so the table stays joined to the
      // catalog rather than accumulating dead rows.
      if (known.has(rec.task_id)) {
        matched++;
        // `input_output` arrives already parsed in most records but as a JSON string in
        // some; normalise to a JSON text column either way.
        let io: string | null = null;
        if (Array.isArray(rec.input_output)) io = JSON.stringify(rec.input_output);
        else if (typeof rec.input_output === "string") {
          try {
            JSON.parse(rec.input_output);
            io = rec.input_output;
          } catch {
            io = null;
          }
        }
        pending.push([rec.task_id, rec.question_id ?? "", rec.entry_point, rec.prompt ?? "", rec.test, io, now]);
      }

      if (pending.length >= 500) {
        flush();
        console.log(`[tests]   ${split}: ${seen} read, ${matched} matched`);
      }
    }
    flush();
    console.log(`[tests] ${split}: ${seen} records, ${matched} matched so far`);
  }

  setMeta("full_tests_imported_at", now);
  console.log(`\n[tests] imported ${imported}, matched to catalog ${matched}`);
  return { imported, matched };
}

if (import.meta.main) {
  await ingestFullTests();
}
