# Engineering notes

The measurements behind [the README](../README.md)'s claims, plus the parts of the build that
only matter if you're changing the code.

Every number here was measured on the machine this runs on. Where a claim was wrong first, the
wrong version is written up in [Things that will bite you](#things-that-will-bite-you).

---

## Test suites: closing the gap on hidden tests

LeetCode's API exposes only `exampleTestcases`, the 2–3 public examples, so a solution that passes
locally can still fail their hidden tests. `newfacade/LeetCodeDataset` (Apache-2.0) closes most of
that gap: 2,869 problems with 3–451 executable cases each, imported in 11 s and joined to the
catalog at 100% by slug.

```bash
bun run ingest:tests
```

The cases run in every language, not just Python. `io_cases` is a JSON array of
`{input: "nums = [3,3]", output: "[0,1]"}` pairs and both sides are parsed in TypeScript, so the
cases were always language-agnostic. Only the dataset's generated `check()` asserts are Python.
`two-sum` is 72 cases in Go and C++ as well as in Python.

Four kinds of case are dropped and reported, never guessed at:

1. **Expected value is `null`** (2,357 cases across 68 problems). These are problems that guarantee
   a solution exists, so the reference solution falls off the end. Measured before the fix: a
   correct JavaScript solution scored 72/80 and a correct C++ solution 71/80. Treating `[]` as "no
   solution" would accept an empty array where it's the wrong answer, a false accept, which is the
   one direction that teaches something untrue.
2. **Arguments the language can't construct.** Java and C++ declare `int` as 32-bit, and the
   dataset contains inputs like `-3000000000` on a problem whose signature is `int[]`. The case
   can't be run, so counting it as a failure would mark a correct solution wrong.
3. **A `void` entry point.** The suite stores only the return value, and a `void` method is graded
   on the mutation it leaves in its argument, so there is nothing to compare against. Measured:
   `sort-colors`' 128 cases all store `None`, so `def sortColors(self, nums): pass` scored 128/128
   accepted. The problem is reported ungradeable (422) rather than graded.
4. **A parameter type no harness can build.** The suite passes `[4,2,7,1,3,6,9]` where the
   signature wants a `ListNode`/`TreeNode`: Python raises `AttributeError`, Java and C++ have no
   coercion, Go substitutes nil. Every case failed, so a correct solution read 0/N.

The last two are suite-level: the whole problem is refused with a plain explanation, because a
zero-case grade would render as "0 of 0 passed" against code that may be correct.

Cases whose stored expected value is a Python exception message (23 records) are dropped rather
than graded, because the dataset's own reference solution crashed on those.

### Arity without metadata

`meta_json` is filled lazily on first open, so 2,851 of the 2,869 problems that have a suite have
no metadata at all. Taking the arity from `meta.params.length ?? 0` therefore rejected every
multi-argument case on those problems: measured, `valid-parentheses` graded 0 of 149,
`palindrome-number` 0 of 61, `two-sum` 0 of 80.

The arity is derived from the input instead, which is `name = value` chunks by construction.
Measured over all 2,869 stored suites:

| | |
|---|---|
| total raw cases | 288,608 |
| arity-derivable and parseable | 286,041 (99.1%) |
| per-problem gradeable range | 3–451 |
| problems left with 0 gradeable | 0 |
| cross-check against real metadata | 18 agree, 0 disagree |

The cross-check is the load-bearing one. For all 18 problems that do have metadata, the derived
arity reproduces the metadata-driven case count exactly, including `two-sum` (80), `valid-anagram`
(107) and `sort-colors` (128). Metadata still wins when it disagrees with the derived count on a
majority of the cases that parsed, which is the signal that the derived parse is wrong for that
problem.

The method name comes from the suite's `entry_point` (`Solution().twoSum` → `twoSum`). Every one
of the 2,869 suites uses the dotted form, and falling back to `""` made the harness look for a
method called nothing: measured on `valid-parentheses`, a correct solution scored 0/148 with
`class Solution has no method` on every case.

### Multiple valid answers

`group-anagrams` accepts any group order, `permutations` any permutation order, `3sum` any triple
order. The imported suites assert exact equality, which marked a correct solution wrong.

`verifiers.ts` holds semantic comparators for those problems: any valid ordering passes, and
everything else keeps strict equality. The list is explicit rather than heuristic, because
guessing "this looks order-free" is how a false accept gets introduced.

The list is wrong in both directions if it isn't maintained, and both were measured:

- **Missing an entry is a false reject.** `two-sum`'s statement says "You can return the answer in
  any order", and the stored reference answer is one specific ordering. Ascending `[i, j]` scored
  72/72; the same correct pair as `[j, i]` scored 0/72. There is now a verifier that accepts either
  order.
- **An extra entry is a false accept.** `partition-labels` returns partition sizes in the order
  the partitions occur: `"ababcbacadefegdehijhklij"` → `[9,7,8]`, and `[7,8,9]` is wrong. It was
  mapped to the order-free comparator, which sorted both sides and accepted the wrong order.

In-language harnesses compare positionally and never see an `orderless` flag, so ordering is
decided in exactly one place.

### Two honest caveats

Both are surfaced in the UI:

1. **They're third-party tests, not LeetCode's.** A far better proxy than the public examples, but
   not authoritative.
2. **They're sometimes stricter than the problem statement.** Measured: Two Sum's suite includes
   `nums = [-1,-2,-3,-4], target = -8 → None`, but the statement promises "exactly one solution",
   so that case is outside the stated contract. The UI shows the exact failing case so you can
   judge rather than guess.

---

## Running other people's code in five languages

The binding rule differs per language, and getting it wrong fails every submission:

| language | LeetCode stub | how it's called |
|---|---|---|
| Python | `class Solution:` + method taking `self` | instantiate, bind |
| Java | `class Solution { public ... }` | instantiate, reflect |
| C++ | `class Solution { public: ... }` | instantiate |
| JavaScript | `var twoSum = function(...)` | bare function |
| Go | `func twoSum(...)` | bare function, reflect |

Java and C++ harnesses are real files under `src/server/harnesses/`. Generating them from string
templates meant every backslash had to survive three escaping layers, and it repeatedly produced
uncompilable code. C++ additionally needs type-directed codegen, since a statically typed language
can't build a generic call site.

Availability is detected at runtime, so a language without a runtime shows as unavailable rather
than failing at submit.

### The timeout kills the process tree

`go run` compiles and then execs the binary as a grandchild. Killing only the direct child left
the grandchild holding the stdout pipe, so the read never saw EOF and the request hung forever,
skipping the cleanup that removes the temp directory.

On POSIX the child is spawned detached and the process group is signalled. Windows has no process
groups, so `taskkill /T` walks the child tree instead. Spawning detached on Windows is not merely
useless but harmful: it made `go run` fail with `error obtaining buildID for go tool compile` and
take 41 s instead of 1.2 s, because the Go toolchain does not tolerate a detached console.

---

## Things that will bite you

All of these were found by running the code, not by reading docs. The full list is long; these are
the ones that cost the most time.

<details open>
<summary><b>17 more, ranked by how long they took to find</b></summary>

**1. FSRS's default interval cap is ~100 years.** `ts-fsrs` ships `maximum_interval: 36500`.
Measured, that produces `3 → 14 → 57 → 196 → 586 → 1559 → 3760 → 8346 days`. The scheduler
silently drops problems you still need, and it looks correct in a demo. This project caps at 90
days with `request_retention: 0.85`. Measured curve after the cap:
`4 → 34 → 89 → 91 → 87 → 89 days`. It can land at 91 because fuzz is applied after the cap, so
treat it as "≈90 ± a couple of days" and never assert `<= 90` in a test.

**2. LeetCode's Python stub is a class method, but `metaData.params` omits `self`.** A naive
harness calls a bare function and fails every submission with `TypeError: missing 1 required
positional argument`.

**3. NeetCode renames problems.** Its slugs differ from LeetCode's for 74 of 250 NC250 entries
(`duplicate-integer` → `contains-duplicate`). Joining on the NeetCode slug matched 176/250;
joining on the `leetcode_url` slug matches 250/250.

**4. kenari prices are `micro_idr_per_1m_tokens`, that is Rp × 1e6.** Verified against the live
gateway: a call with 38 input and 29,000 output tokens moved the quota by exactly Rp 1, which the
Rp 20/M reading predicts (Rp 1.45) and an Rp 150/M reading does not (Rp 8.71). Prices also change:
the same model was listed at 150,000,000 and 20,000,000 micro-IDR on the same day, so the client
reads rates from the cached catalog instead of a hardcoded table.

**5. A verbatim quote of the student's own code matches the leak detector.** `findRealSyntax`
matches `def `, `for(`, `return x(`, patterns that appear in the student's own line. So the
tutor's `focus` field must never reach `detectViolations`, or every line-specific hint would be
rejected as a leak below H4. `detectViolations` takes `Omit<Turn, "focus">` so the separation is a
compile error rather than a convention.

**6. A case's index must match the harness's own numbering.** `prepareSuite` kept the original
suite position while the harness enumerated its payload from 0. The two agreed only until the
first skipped case, after which every lookup returned "no result returned" for cases that had run
perfectly. Measured as a correct Python `two-sum` scoring 5/72.

**7. Java and C++ never decoded JSON string escapes.** `encodeJavaValue` JSON-escapes every
argument, so a tab arrived as the two characters `\` `t`. Measured: a `charSum("a\tb")` probe
returned 403 instead of 204, the difference being exactly the escape characters (92 + 116 − 9).
Python, JavaScript and Go decode for free, so this only ever broke in two of five languages.

**8. Go cannot import from inside user code.** A Go import declaration must precede every other
declaration, and the harness splices user code in after its own imports, so `sort.Slice` and
`strings.Fields` were simply unavailable and a correct Go solution failed to compile. The runner
now retries once with the packages the compiler named in its `undefined: X` errors. Per-language,
because Go rejects unused imports, so a blanket list breaks every submission that doesn't use
them.

**9. C++'s `int[]` comparison sorted both sides.** It would have accepted a wrong order on a
problem that cares about order, and there was no `string[]` comparison at all, so every `string[]`
problem reported "unsupported signature".

**10. `!statementMd` is not "not fetched yet".** A Premium problem stores an empty statement by
design, and an empty string is falsy, so the old guard re-fetched from LeetCode on every single
page view of a locked problem, for a result that can't change. Measured after the fix: re-open is
~1 ms against ~344 ms for a real fetch.

**11. Bun's `db.exec` rejects a comment-only SQL script.** A migration whose entire content is
comments throws "Query contained no valid SQL statement", which aborts the migration and leaves it
recorded as unapplied.

**12. `bun build --compile` breaks `import.meta.dir`.** It becomes `B:\~BUN\root`, a virtual path
inside the executable: `readdirSync` throws `ENOENT`, `Bun.file` fails the same way, and
`Bun.Glob(...).scan` returns zero entries. There is no embedded-asset escape hatch. Resources must
be resolved from `dirname(process.execPath)`. The portable way to detect this mode is
`Bun.isStandaloneExecutable`; a `~BUN` substring check matches on Windows but not on Linux or
macOS, where the root is `/$bunfs/root`.

**13. Design problems have a different metadata shape.** "Implement a Trie" has a `classname`, a
`constructor`, and a list of `methods`, not a single function signature.

**14. Official hints are raw HTML.** Stored and rendered verbatim, a hint read
"say `<code>x</code>`" instead of "say `x`".

**15. `/v1/models` advertises models the router cannot serve.** 3 of 8 `:free` models returned
`model_not_found` when actually called. Never hardcode a model id.

**16. The C++ harness had no `unquote`.** `cppUnpack` passed scalar string arguments through with
their JSON quotes intact, so `f("()")` received the 4-character string `"()"`.

**17. An XML comment cannot contain `--`.** The brand mark's first draft documented its own
palette using the CSS token names (`--ink`, `--signal`), which made the SVG invalid XML and
therefore completely unparseable. It rendered as nothing, everywhere, including as the favicon.

**Also:** LeetCode's `__type` introspection is disabled, `companyTags` returns null
unauthenticated, and the SQL study plan's slug is `top-sql-50` (`sql-50` returns `null` silently
rather than erroring).

</details>

---

## SQL 50 details

The reference query is the oracle, not the statement's rendered `Output:` table. Parsing those
ASCII tables would be a second parser to get wrong, and one of them is wrong:
`group-sold-products-by-the-date` shows `T-shirt` where its own seed row is `T-Shirt`. That
discrepancy is recorded in `catalog.test.ts` rather than papered over.

Three things the fetch turned up that the code has to handle:

- **`exampleTestcases` is newline-delimited** when a problem has more than one case. Three of the
  50 have two cases, and a single `JSON.parse` throws `Unable to parse JSON string` for exactly
  those three.
- **`metaData.mysql` needs normalizing** before SQLite accepts it: `ENUM(...)` → `TEXT`, no
  `AUTO_INCREMENT`, no `UNSIGNED`, no backticks, no `varchar(n)` lengths. With the normalizer,
  50/50 problems seed cleanly; without it, three fail on `ENUM`. The same normalizer runs for the
  schema pane, so what you read is what the query ran against.
- **One problem's answer is a `DELETE`.** `delete-duplicate-emails` returns no rows, so it's graded
  on the table state it leaves, which is why the "must be a SELECT" guard is derived from the
  reference query's shape rather than applied blanket.

The row cap is a transport limit, not a comparison limit. Two result sets that are the same
multiset of 250 rows must both pass, so the cap is applied to the copy sent to the browser rather
than before the multiset sort. `catalog.test.ts` proves every one of the 50 reference queries
executes against the real stored seed data and returns the rows the statement publishes: a wrong
oracle would grade a correct answer as wrong, which is worse than not grading at all.

---

## Content tests

The executable track content is tested rather than trusted.

`concepts.test.ts` and `components.test.ts` run every exemplar against its own tests, so a wrong
exemplar fails in the language it's wrong in rather than being taught as the answer. The starter
must also compile and must fail, because a scaffold that already passes teaches nothing.

The component catalogue's ops/expected pairs are cross-checked: every op appends at most one
value, so an `expected` longer than its `ops` is a copy-pasted test. Verified across all 12
components that no test exceeds one expected value per op.

---

## Architecture

```
src/server/
  db.ts          bun:sqlite handle + migration runner
  paths.ts       resource resolution for source AND compiled runs
  leetcode.ts    GraphQL client, HTML→markdown
  ingest.ts      catalog + curated-list ingestion
  executor.ts    test-case parsing from statements + exampleTestcases
  runner.ts      multi-language execution harnesses (py/js/java/cpp/go)
  grading.ts     structured I/O grading + semantic verifiers
  srs.ts         ts-fsrs wrapper, behavioural grading, pattern + design cards
  mastery.ts     per-pattern Elo, weakness ranking, hint dependence
  milestones.ts  18 achievements, each a query over the attempt log
  concepts/      the 31-concept catalogue + one code file per language
  components/    the 12-component catalogue + one code file per language
  sql/           SQL 50: ingest, the 50 reference queries, seeding + execution
  design/        5-phase round: probe policy, reveal detector, rubric
  tutor/         hint ceiling, code-reveal detection, model routing
  tracks/        behavioral + stack: session state and orchestration
  project/       project learning: directory scanner + curriculum generator
  project.ts     project learning: reads and the module session lifecycle
  cv/            ATS CV: doc model, LaTeX render, compile, checks, keywords
  index.ts       Hono API, and the built UI when there is one

src/ui/
  App.tsx        overview / list / review / workspace / settings
  shortcuts.ts   the `g`-chord table, read by the handler and the documentation
  assets/        the brand mark (also the favicon and the desktop icon source)
  components/    CodeMirror editor, tutor panel, and one view per track

src-tauri/       desktop shell: spawns the compiled sidecar, opens the window
scripts/         build-desktop.ts, ingest-desktop.ts, demo-db.ts
```

No ORM, no state library, no UI kit. Dependencies are `hono`, `ts-fsrs`, `react`, `vite`,
`@codemirror/*`, and `@tauri-apps/cli` for the desktop build.

### Data model

| table | holds |
|---|---|
| `problems`, `lists` | the catalog |
| `cards` | DSA review state, keyed by `qid` |
| `attempts` | every solve, with hint usage and timing |
| `tutor_turns` | the honest-mode audit trail, including withheld turns |
| `items` + `item_cards` | review state for every non-DSA track, keyed by `item_id` |
| `concept_exercises`, `component_exercises` | executable track content |
| `design_sessions`, `track_sessions` | prose-track rounds and their transcripts |
| `projects`, `project_modules`, `project_jobs`, `project_sessions` | an imported codebase, its generated curriculum, the generation job the UI polls, and one row per graded module answer |
| `cv_documents` | CVs as structured JSON; the `.tex` and PDF are derived on demand |
| `pattern_mastery`, `milestones` | derived readouts, recomputed never incremented |

The non-DSA tracks live in `items` + `item_cards` rather than `cards`, because DSA review is keyed
by `qid` and driven by execution outcome while everything else is keyed by `item_id`. They share
one scheduler and one grade derivation, with `reviewItem` mirroring `reviewCard` exactly and
differing only in the table.

A SQL attempt is written to `attempts` with `language = 'sql'`, so the SQL track counts toward the
streak, the milestone queries and the weekly history with no special case anywhere downstream.

### Derived readouts

Milestones are evaluated on read, like `recomputeMastery`: cheap aggregate queries, so a milestone
reached while the server was down still lands on the next read, and awarding is
`ON CONFLICT(id) DO NOTHING`. Only earned rows are stored; a row's presence is the award, and
`progress` is recomputed rather than stored.

`activeDays` counts days inside the 52-week calendar window rather than over all history, because
it's printed directly beneath that grid and an all-time count can exceed the number of filled
cells the reader can see.

---

## Project learning: reading a directory the user points at

The scanner (`project/scan.ts`) is the only code in the repo that reads an arbitrary directory, so
its rules are explicit and conservative. Symlinks are never followed — a symlinked `node_modules`
or a loop cannot be traversed. The heavy build and vendor directories are named rather than guessed,
and `VENDORED_RE` catches a checked-in third-party checkout by name at ANY depth: the exact-name
list cannot see `training/.venv`, because the walker reaches it through `training/`. A NUL byte in
the first 8 KB makes a file binary; a file over 256 KB is skipped as large; a `.min.js` or a
`.js`/`.css` whose first line exceeds 400 chars is skipped as minified. A single unreadable file is
skipped, not fatal: `readFile` inside a `try`/`catch` per file. The hard caps (8 MB, 400 files) exist
so a mistaken path cannot read the machine into memory.

**The order candidates are considered in is what decides what a large project's curriculum can see**,
and this was got wrong twice on a real repo. `id-eval` has 57,341 files; ordering by path depth spent
359 of the 400-file budget inside `training/` (a vendored `training/.llamacpp` plus a nested
`training/.venv`) and left 14 slots for the project's own `src/ideval/**`. Candidates are therefore
grouped by top-level directory, ranked within each (`sourceRank`: real source, then prose and config,
then anything under a dot-directory), and **round-robined across groups**. Every part of the project
gets a turn before any part gets a second one, which is what "representative sample" has to mean when
the sample is capped. After the fix the same repo scans as 61 files, untruncated, all of them its own.

Generation is two model calls deep: one to plan the module map from the file listing, then one per
module from that module's actual file text. `project_jobs` is the progress channel the UI polls, and
the HTTP request that starts a run returns 202 immediately.

A path the model proposes is accepted when the scan read it, **or** when it exists on disk and is the
kind of file the scanner would have read. That second case is not a loophole: because the scan is
capped, the model — which sees only the capped list — legitimately names real files the cap excluded,
and treating those as hallucinations threw away its best modules and failed the run on a project whose
source is perfectly scannable. `existsSync` is still required, so a genuinely invented path is rejected
rather than becoming a module with no file text.

A module that comes back malformed — missing one of the six required `##` sections, or carrying fewer
than four questions — is **skipped, not fatal**. The earlier modules are already written, and aborting
the run because its ninth module failed discards eight good ones. The run ends `ready` with the skipped
titles named in `projects.error`, surfaced as a warning. A module with MORE than six questions is
trimmed to six rather than rejected; the model returned seven on a real run, and one extra question is
not worth failing a module over. Only a run that produced nothing at all is an error.

The module call's budget is `MODULE_MAX_TOKENS = 16_000`, and the number was measured rather than
chosen. A module must emit a ~12,000-character study document plus six questions, and the budget that
works depends on the INPUT size, because a bigger payload makes the model reason longer before it
emits its tool call. Measured on `deepseek-v4-1-flash`:

| payload | max_tokens | result |
|---|---|---|
| 35k chars | 8,000 | `finish=length`, **no tool call at all** |
| 60k chars | 8,000 | `finish=length`, **no tool call at all** |
| 60k chars | 16,000 | `finish=tool_calls`, valid module |
| 35k chars | 16,000 | `finish=tool_calls`, valid module |

At 8,000 the entire budget goes to reasoning and nothing comes back, which surfaces only as
"structured output failed validation twice". This is exactly the trap `tutor/client.ts` documents as
Rule 3, and the fix is the same one: give the budget the output actually needs.

Regeneration identifies a module by its FILE SET, not its title. A planned module whose files exactly
match an existing module's is reused verbatim: no model call, and the slug — and therefore the
`items` row, the `item_cards` row and every graded `project_sessions` row — survives untouched.
`items.ref` is the composite `<projectSlug>/<moduleSlug>`, because `items` is unique on
`(kind, ref)` and a project-level ref would give every module one shared card.

---

## The CV: why the preamble is not decoration

The `.tex` template's preamble is an ATS requirement, and the parts of it that matter were measured
rather than assumed. On MiKTeX 26.1, with the document this repo's test fixture builds:

| preamble | `pdffonts` | `pdftotext` |
|---|---|---|
| `[T1]{fontenc}` + `lmodern` + `cmap` | Type 1, `emb=yes uni=yes` | `financial` intact |
| `lmodern` + `cmap`, no `fontenc` | Type 1, `emb=yes uni=yes` | `financial` intact |
| `[T1]{fontenc}` + `cmap`, **no `lmodern`** | **Type 3, `emb=yes uni=no`** | **`nancial`, `ecient`, `workow`** |
| no font packages at all | Type 1 (Computer Modern), `uni=yes` | `financial` intact |

The third row is the failure this feature exists to catch, and it is why `keywords-survive` and
`fonts-embedded` are checks: dropping `lmodern` makes pdfTeX fall back to Type 3 bitmap fonts with
no ToUnicode map, and every ligature disappears from the extracted text. `cmap` alone changes nothing
on this machine — `lmodern` already ships Type 1 fonts with a ToUnicode map — but it stays as the
portable belt to `lmodern`'s braces for a distribution whose fallback differs. The regression test
targets the line that is observable here, because a check that cannot fail is not a check.

The rest of the template is structural: one column (a two-column template scrambles extraction
order), plain-text headings (a parser classifies a section by its heading string), a pipe-separated
contact line with no icon fonts (an icon extracts as junk glued to the email), and dates on the title
line via `\hfill` rather than in a separate column.

`GET /api/cv/:id/pdf` is the only non-JSON response in the server, and it serves `inline` unless
`?download=1`. That distinction is load-bearing: the same URL is both the preview's `<iframe src>`
and the download link, and `attachment` on both makes the iframe trigger a file download instead of
displaying the PDF.

---

## Desktop app internals

The window is a thin Rust shell; the whole application is the Bun sidecar, which serves the built
UI and the JSON API from one port. The shell:

1. picks a free port by binding port 0 and releasing it. A fixed port collides with the Vite dev
   server on 5174 and the API's own 5173, and a collision here looks like "the app opens a blank
   window" with nothing to explain it;
2. passes it to the sidecar along with `PREP_RESOURCES`, `PREP_UI_DIR` and `PREP_DB_PATH`;
3. waits for the port to accept, then navigates. The window stays hidden until then, so there's no
   white flash;
4. kills the sidecar on exit, because otherwise it keeps its port and its 82 MB alive with no
   window to close it from.

The database lives in the app's data directory rather than next to the executable, because an
installer's program-files directory isn't writable and progress belongs with the user's data
either way. That's why the desktop app needs its own ingest run.

<details>
<summary><b>Measured sizes</b> (release build)</summary>

| | |
|---|---|
| Sidecar (`prep-server.exe`) | 82.8 MB |
| Rust shell (`prep.exe`) | 4.5 MB |
| Shipped resources (migrations, harnesses, built UI) | 1.05 MB |
| **NSIS installer** | **33.0 MB** |

The sidecar dominates, and the installer is smaller than it because NSIS compresses it. The
alternative, loose JS plus a system Bun install, reintroduces exactly the dependency the desktop
build exists to remove.

</details>

<details>
<summary><b>Why the resource directory is not optional</b></summary>

Under `bun build --compile`, `import.meta.dir` becomes a path inside the executable, so
`readdirSync` on it throws `ENOENT`. `src/server/paths.ts` resolves every resource from
`dirname(process.execPath)/resources` when compiled and from the source directory otherwise, and
the build ships `migrations/`, `harnesses/` and `ui/` into that directory.

The Windows installer uses `embedBootstrapper` for WebView2: ~1.8 MB, and the install works
offline. `offlineInstaller` (~127 MB) and `fixedVersion` (~180 MB) buy nothing here.

</details>

---

## Verifying a change

```bash
bunx tsc --noEmit
bun test                                  # ~232 tests, 22 files, ~250 s
bun run src/server/concepts/verify.ts     # every exemplar against its own tests
```

`bun test` runs the full matrix, which compiles and executes every exemplar in all five languages.
That's the slow part and the reason the suite takes minutes rather than seconds.

The CV tests compile real LaTeX through the machine's own engine and are skipped when `pdflatex` is
absent, so the suite stays green on a machine without TeX. They are also the slowest single file
after the language matrix, which is expected: each case runs the engine twice.

The project-learning tests stub `tutor/client.ts` with canned tool payloads but run the REAL
validators, so they assert the shapes the generator actually accepts rather than what a stub agreed
to accept. They call `migrate()` against the temp copy the test preload creates, because that copy's
schema comes from the live database and does not know about migrations applied since.

For a throwaway database with plausible progress, for screenshots or for poking at the UI without
touching real progress:

```bash
bun run scripts/demo-db.ts
```

It copies the catalog to a temp file, seeds fake history there, and prints the `PREP_DB_PATH` to
run the server with.

---

## Build history

<details>
<summary><b>All phases complete</b></summary>

- **Phase 1** — catalog, executor, SRS, review queue
- **Phase 2** — the tutor: deterministic hint ceiling, code-reveal detector, validate/repair
- **Phase 3** — per-pattern mastery, weakness view, company tags, model picker
- **Phase 3.5** — full test suites, multi-language execution, roadmap, sort/filter/group
- **Phase 3.6** — semantic grading for multi-answer problems, dark editor theme, true list sizes
- **Phase 3.7** — settings + reset, premium statements, editor language fix, autocomplete assist,
  hint code-focus, fundamentals track, suites in all five languages
- **Phase 3.8** — pattern-level review cards, so the schedule matches the mastery data
- **Phase 4** — system design: the 5-phase round with a probe-gated interviewer, rubric grading,
  and 12 executable components on the same prompt
- **Phase 5** — behavioral and stack tracks, graded against a rubric with verbatim-quote evidence
- **Phase 6** — SQL 50 graded by execution, language-specific depth, 18 milestones, UX pass,
  brand mark, and one-action startup behind a desktop app
- **Phase 7** — adversarial audit of the shipped code: 57 defects fixed across verdicts, the
  grading path, derived readouts, the API and the UI

</details>

---

## Hosting and multiplayer

Not built, and the reasons are written up in [`HOSTING.md`](../HOSTING.md). In short: the app
caches LeetCode's statement text, so serving that cache to other people is redistribution; and
user code runs as a child of the server with no sandbox, which is fine for one person on one
machine and a remote-code-execution hole with two.
