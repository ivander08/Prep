# Prep

A local-first interview prep tool: 4,068 LeetCode problems, spaced repetition, and (soon)
an AI tutor that refuses to give you the answer.

Personal tool, single-user, no accounts, no hosting. Everything lives in one SQLite file
on your machine.

## Why this exists

Every prep platform ships a question bank. Almost none ship a **retention loop**, and the
ones that do are tiny and have no AI. Meanwhile the research is unambiguous:

- **An answer-giving AI tutor makes you measurably worse.** Students given unrestricted
  GPT-4 access performed ~17% *worse* on an unaided exam than a no-tool control; the same
  model rebuilt to withhold answers erased the harm (Bastani et al., PNAS 2025).
- **LLM judges misreject correct code.** Published correct-code rejection rates fall from
  52.4% to 11.0% as prompts get more elaborate. A correct-but-slow brute force is exactly
  the class that gets misjudged.
- **Spaced repetition is the gap.** NeetCode Pro's own feature page contains zero
  occurrences of "spaced", "repetition", "schedule", "SRS", or "Anki".

So the two design rules this project holds to:

1. **Execution decides correctness; the LLM only narrates why.** Never let a model be the
   source of truth for whether your code works.
2. **Grade from behaviour, not self-report.** The review schedule is derived from whether
   the tests passed, how many hints you used, and how long it took — never from asking
   "how well did you remember?"

## Status

Phase 1 of 5 is complete and verified.

| | |
|---|---|
| Catalog | 4,068 problems, full metadata |
| Curated lists | Blind 75, NeetCode 150/250/All, LeetCode 75, Top Interview 150, SQL 50 — all **100%** joined |
| Executor | Python, deterministic verdicts, subprocess-isolated |
| Scheduling | ts-fsrs (FSRS-6), capped at 90 days |
| UI | Roadmap list, problem workspace, run + grade, review queue |
| Tutor | not yet (Phase 2) |

## Quick start

```bash
bun install
bun run ingest        # ~37 s, fetches the catalog and all curated lists
bun run dev           # API on :5173
bunx vite             # UI on :5174
```

Then open http://localhost:5174.

```bash
bun test              # 19 tests
bunx tsc --noEmit
```

## Architecture

```
src/server/
  db.ts          bun:sqlite handle + migration runner
  leetcode.ts    GraphQL client, HTML→markdown
  ingest.ts      catalog + curated-list ingestion
  executor.ts    Python subprocess harness, verdicts
  srs.ts         ts-fsrs wrapper, behavioural grading
  index.ts       Hono API
src/ui/
  App.tsx        overview / list / review / workspace
  components/    CodeMirror editor
```

No ORM, no state library, no UI kit. Dependencies are `hono`, `ts-fsrs`, `zod`, `react`,
`vite`, `@codemirror/*`.

### Data model

`problems` and `lists` are the catalog. `cards` is DSA review state. `attempts` is every
solve, including hint usage and timing. `tutor_turns` is the honest-mode audit trail.

`cards` and `item_cards` are deliberately separate tables: DSA review is driven by
execution outcome, non-DSA review by self-rating. Conflating them is what makes other
tools' SRS feel wrong.

## Things that will bite you

All four of these were found by running the code, not by reading docs.

**1. FSRS's default interval cap is ~100 years.** `maximum_interval` defaults to `36500`
days, producing 3 → 14 → 57 → 196 → 586 → 1559 → 3760 → 8346 days. The scheduler silently
stops showing you problems you still need, and it looks perfectly correct in a demo. This
project caps at 90 days with `request_retention: 0.85`.

**2. The interval cap is not exact.** Fuzz is applied *after* the cap, so a 90-day cap
measured 91. Don't assert `<= 90` in a test. Fuzz is also deterministic (seeded to 42), so
runs are reproducible.

**3. LeetCode's Python stub is a class method, but `metaData.params` omits `self`.** A
naive harness calls a bare function and fails *every* submission with
`TypeError: missing 1 required positional argument`. The harness must instantiate
`Solution()` and bind the method. The binding rule differs per language — JavaScript's stub
is a bare `var twoSum = function(...)` with no class at all.

**4. NeetCode renames problems.** Its slugs differ from LeetCode's for 74 of 250 NC250
entries (`duplicate-integer` → `contains-duplicate`, `is-anagram` → `valid-anagram`).
Joining on the NeetCode slug matched 176/250; joining on the `leetcode_url` slug matches
250/250.

Also: LeetCode's `__type` introspection is disabled, `companyTags` returns null
unauthenticated, and the SQL study plan's slug is `top-sql-50` — `sql-50` returns `null`
silently rather than erroring.

## Known limitations

**The local judge is approximately as strict as LeetCode's, not identical.** Only
`exampleTestcases` are public; LeetCode's hidden tests are not in the API. A green run here
does not guarantee a green run there, and the UI says so on every result rather than
letting you assume otherwise.

## Legal

This is a personal, local tool. Problem statements are fetched on demand from LeetCode's
public GraphQL endpoint and cached locally; nothing is redistributed. LeetCode's
`robots.txt` disallows `/graphql` and its ToS prohibits scraping, which is why this is not
a hosted product and why the repo ships no problem content.

## Roadmap

- **Phase 1** — catalog, executor, SRS, review queue ✅
- **Phase 2** — the tutor: deterministic hint ceiling, code-reveal detector, validate/repair
- **Phase 3** — per-pattern mastery, weakness view, company tags, SQL track
- **Phase 4** — system design: 45-min mock, rubric grading
- **Phase 5** — stack-specific and behavioral tracks
