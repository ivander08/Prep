# Hosting, login and multiplayer: a feasibility verdict

## Verdict

Hosting this app for other people is not advisable, and the reason is not one problem but two
independent ones that compound. The content it displays is fetched from a source that forbids
automated access (`robots.txt` disallows `/graphql`, verified live — see Blocker 1), and the
code it runs for the user executes as a child of the server with no isolation whatsoever (see
Blocker 2). Either one alone would be a hard blocker for serving the app to a second person;
together they rule out the combination as asked about.

Hosting a **reduced** app — first-party content only, no code execution — is technically
feasible. It is not free: it requires rebuilding the tenancy model (Blocker 3), because there is
no user concept anywhere in the schema or the server. That is a larger project than the app
itself, and it is a different project.

This document is a report. It produces no code and changes no schema. The evidence below was
verified by reading each cited file:line during this work, and by fetching LeetCode's
`robots.txt` live.

---

## Blocker 1 — the content

The app fetches problem statements, hints, examples and starter snippets from LeetCode's public
GraphQL endpoint and caches them in the local `problems` table.

- The endpoint: `src/server/leetcode.ts:14` — `const ENDPOINT = "https://leetcode.com/graphql/";`.
- The lazy fetch: `src/server/index.ts:143` — `const detail = await fetchProblem(slug);`, guarded
  by `src/server/index.ts:141` (`if (row.fetched_at === null && statementSource !== "manual")`)
  so a problem is fetched once and never again. The same block writes `statement_md`, `hints`,
  `snippets`, `meta_json` and `examples` back into `problems` (`src/server/index.ts:152-159`).
- The provenance column: `src/server/migrations/009_premium_statement.sql:11` —
  `ALTER TABLE problems ADD COLUMN statement_source TEXT;`, documented at lines 8-10 as
  `'leetcode'` for a fetch and `'manual'` for something the user pasted.

LeetCode's `robots.txt` disallows `/graphql`. This was verified by fetching
`https://leetcode.com/robots.txt` live during this work; the fetched file contains the line
`Disallow: /graphql`. That is not a new finding — the README's own Legal section already records
it at `README.md:550-553`:

> This is a personal, local tool. Problem statements are fetched on demand from LeetCode's
> public GraphQL endpoint and cached locally; nothing is redistributed. LeetCode's `robots.txt`
> disallows `/graphql` and its ToS prohibits scraping, which is why this is not a hosted product
> and why the repo ships no problem content.

Serving those cached rows to other people converts "fetched on demand by its one user" into
"redistributed from a server". That is exactly the act the README says this design avoids, and
it is why the repo ships no problem content. The local-only decision is what keeps the app on
the right side of LeetCode's terms; hosting removes it. `src/server/leetcode.ts:1-9` states the
same reasoning in the module header.

**What is not the problem.** Two of the app's data sources are licensed for redistribution and
are not a reason to withhold hosting:

- The test suites come from `newfacade/LeetCodeDataset` (Apache-2.0), imported by
  `src/server/migrations/006_full_tests.sql` (the licence is stated at line 7, and `source`
  defaults to `'newfacade/LeetCodeDataset'` at line 26).
- The curated list data comes from `neetcode-gh/leetcode` (MIT) and
  `ascherj/neetcode-250-guide`, described at `src/server/ingest.ts:4-7`.

The problem is specifically the statement, hint and example text, which is LeetCode's own prose
and is not licensed for redistribution at all. A hosted app that omitted those rows but kept the
Apache-2.0 suites and the MIT lists would have a much smaller exposure — but the suites are only
useful alongside problems, and the app's central screen is the statement, so this is a reduction,
not a fix.

---

## Blocker 2 — the executor

User code runs as a child process of the server with **no isolation of any kind**: no container,
no `chroot`, no uid change, no `rlimit`, no cgroup and no network restriction. Verified by
grepping `src/server/` for `ulimit|setrlimit|cgroup|chroot|seccomp|bwrap|firejail|docker`; the
grep returns **nothing**. Nothing in the server constrains what a submitted program may do.

- The spawn: `src/server/runner.ts:419` —
  `const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", cwd: dir });`. `cwd` is a fresh
  temp directory (`src/server/runner.ts:402-403`), but **no `env` is passed**, so the child
  inherits the server's environment — including `KENARI_API_KEY` (read at
  `src/server/tutor/client.ts:30` and `src/server/index.ts:955`).
- The only enforcement: `src/server/runner.ts:420` —
  `const killer = setTimeout(() => proc.kill(), timeout);`. A wall-clock timer that kills the
  **direct child** and not its grandchildren. A program that forks a background process and
  exits leaves that process running past the timeout.

On one machine, for one person, this is correct: it is your own code on your own box, and a
timer is enough to stop an infinite loop from hanging the UI. With a second user it becomes a
remote-code-execution hole with the server's full privileges. A submitted program can:

- read `data/prep.db` — the database path is `src/server/db.ts:10`, a real file next to the
  source, reachable from any process the child can spawn — exposing every user's progress and
  the API key stored in `meta`;
- read `process.env` and pick up `KENARI_API_KEY` directly;
- make outbound network calls, since nothing restricts the network;
- fork without limit, since there is no process-count limit;
- allocate without limit, since there is no memory limit.

This is a blocker for **multiplayer specifically**, independent of the content question. A 1v1
match is defined by both players submitting code; a stranger's submitted program runs on your
server with your credentials. Even the current single-user case is only safe because the only
person submitting code is the person who owns the machine.

---

## Blocker 3 — the tenancy model

There is no user concept anywhere. Verified by grepping `src/server/index.ts` for auth
middleware — `app.use(`, `session`, `cookie`, `Authorization` — which returns **nothing** for
`app.use(` and `cookie`; the only `Authorization` occurrences in `src/server/` are outbound
(`src/server/tutor/client.ts:171` when calling the model, and `src/server/patterns.ts:70` when
calling GitHub), never inbound. There is no request authentication of any kind.

Nor is there a user table. Grepping `src/server/migrations/` for `CREATE TABLE` matching
`users`, `accounts` or `profiles` returns nothing; the only `session` tables are
`design_sessions` and `track_sessions`, and both name a practice round, not a login — neither
has a user column to point at.

Every table that holds user state is global — one row per thing, not one row per user:

| table | created in |
|---|---|
| `cards` | `src/server/migrations/001_init.sql:33` |
| `attempts` | `src/server/migrations/001_init.sql:50` |
| `tutor_turns` | `src/server/migrations/001_init.sql:70` |
| `pattern_mastery` | `src/server/migrations/001_init.sql:90` |
| `item_cards` | `src/server/migrations/001_init.sql:111` |
| `model_roles` | `src/server/migrations/003_patterns_companies_models.sql:26` |
| `design_sessions` | `src/server/migrations/011_design_sessions.sql:11` |
| `track_sessions` | `src/server/migrations/014_track_sessions.sql:10` |

None of them has a `user_id` column, and no query filters by one.

`meta` is a process-wide singleton (`src/server/migrations/001_init.sql:125`,
`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`) holding the API
key in plaintext under the key `kenari_api_key` — written by `setMeta` at
`src/server/db.ts:62-65`, read by `getMeta` at `src/server/db.ts:57-60`, and set over HTTP by
`POST /api/settings/key` at `src/server/index.ts:962-969` (`setMeta("kenari_api_key", key)` at
line 967), which stores the raw key with no encryption. One key serves every user of the
process.

`POST /api/reset` deletes from eight of those tables with no scoping
(`src/server/index.ts:1013`). The handler loops over `["tutor_turns", "attempts", "cards",
"item_cards", "pattern_mastery", "milestones", "design_sessions", "track_sessions"]`
(`src/server/index.ts:1021`) and deletes each. Under a single-user design that is correct.
Hosted, one user's reset destroys everyone's progress.

Multi-tenancy therefore means adding a `user_id` to those eight tables, threading it through
every read and write path in `src/server/`, and giving each user their own API key — or routing
model calls through a metered proxy so one person's usage does not bill another's credential.
None of that exists today.

---

## The constructive half

The verdict above says no to a specific combination. It does not say no to social features
altogether. Three things are worth stating plainly.

### A reduced hosted app is feasible

Everything the app itself authored carries no third-party restriction, because it is original
content written for this app:

- 31 concept exercises (`src/server/concepts/catalog.ts`, `CONCEPTS` at line 68)
- 12 components (`src/server/components/catalog.ts`, `COMPONENTS` at line 74)
- 61 design concepts (`src/server/design/concepts.ts`, `DESIGN_CONCEPTS` at line 66)
- 12 design prompts (`src/server/design/catalog.ts`, `DESIGN_PROMPTS` at line 43)
- 19 pattern reference cards (`src/server/reference/catalog.ts`, `PATTERN_REFS` at line 60)
- milestones (`src/server/migrations/013_milestones.sql:8`) and streaks

A hosted version that ships only this — no LeetCode-derived statement, hint or example text, and
no code execution — is legally clean. It needs the tenancy work of Blocker 3 and neither a
content licence nor a sandbox. That is the shape of a feasible hosted product, and it is a
different product from the one that exists.

### The async 1v1 shape that survives

If matches are graded from **behaviour** rather than from executed code, they need no sandbox.
Two players answer the same design prompt or behavioural prompt, both answers are graded by the
rubric, and the comparison is on grade, time and hint equivalents. No code runs, so Blocker 2
does not apply; the only content is first-party, so Blocker 1 does not apply either. That is the
async ladder, and it works entirely on content the app owns.

It still needs the tenancy work — per-user rows for the answers, the grades and the ladder
position — but it needs neither a sandbox nor a content licence. This is the version of "1v1"
that is reachable.

### What a real sandbox would take

If code execution for multiple users is ever wanted, this is the requirement set it would have to
meet. It is named here as the scope of the work, **not** as a recommendation to proceed:

- one container per run, so a run cannot see another's files or processes;
- no network namespace, so a submission cannot exfiltrate the environment or the database;
- a non-root uid inside the container;
- `rlimit` on memory, CPU and process count, so a submission cannot exhaust the host;
- a kill of the whole process group rather than the direct child, replacing the current timer at
  `src/server/runner.ts:420`;
- the API key removed from the child's environment, so `Bun.spawn` at
  `src/server/runner.ts:419` passes an explicit `env` rather than inheriting the server's.

Each of these is a real piece of engineering. Together they are a project in their own right,
and they still leave Blocker 1 unresolved, because a sandbox fixes the executor and not the
content.

---

## Recommendation

Keep the app local-first as it is. That is not a compromise — it is the design the app was built
for, and it is the only combination that is safe under both the content terms and the executor's
absence of isolation.

If social features are wanted, build them against first-party content with the async comparison
shape described above. That version needs the tenancy work and nothing else: no sandbox, because
nothing executes, and no content licence, because nothing is redistributed. It is a smaller,
cleaner project than hosting the app as it stands, and it is the one that can actually be built.
