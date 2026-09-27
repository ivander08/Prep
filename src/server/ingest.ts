/**
 * Ingest: populate the local catalog and curated-list membership.
 *
 * Sources and why each was chosen (all verified 2026-09-27, see dossier §3.2):
 *   - neetcode-gh/leetcode  .problemSiteData.json — MIT, 450 entries, carries
 *     neetcode150 + blind75 flags, pattern, difficulty, solutions in 14 languages.
 *   - ascherj/neetcode-250-guide — neetcode_250_complete.json, 250 problems.
 *   - LeetCode studyPlanV2Detail — LeetCode 75, Top Interview 150, SQL 50 (free).
 *
 * THE GOTCHA THAT MATTERS: NeetCode RENAMES problems, so its slugs differ from
 * LeetCode's for 74 of 250 NC250 entries (duplicate-integer → contains-duplicate,
 * is-anagram → valid-anagram, two-integer-sum → two-sum). Joining on the NeetCode slug
 * matched only 176/250. Joining on the `leetcode_url` slug matches 250/250.
 */

import { db, migrate, setMeta } from "./db.ts";
import { fetchCatalog, fetchStudyPlan } from "./leetcode.ts";

const NEETCODE_DATA_URL =
  "https://raw.githubusercontent.com/neetcode-gh/leetcode/main/.problemSiteData.json";
const NC250_URL =
  "https://raw.githubusercontent.com/ascherj/neetcode-250-guide/main/neetcode_250_complete.json";

// LeetCode's own plans. NOTE `top-sql-50`, not `sql-50` — the latter returns null
// silently, which looks identical to an empty plan.
const STUDY_PLANS: Array<{ slug: string; name: string }> = [
  { slug: "leetcode-75", name: "leetcode75" },
  { slug: "top-interview-150", name: "topInterview150" },
  { slug: "top-sql-50", name: "sql50" },
];

type NcEntry = {
  neetcode150?: boolean;
  blind75?: boolean;
  problem: string;
  pattern: string;
  link: string; // e.g. "contains-duplicate/" — a NEETCODE slug, not a LeetCode one
  difficulty: string;
};

type Nc250Entry = {
  name: string;
  difficulty: string;
  category: string;
  leetcode_url: string; // authoritative LeetCode URL
  slug: string; // NeetCode's slug — do NOT join on this
};

/** Extract the LeetCode slug from any of the shapes these sources use. */
function leetcodeSlug(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = /\/problems\/([^/?#]+)/.exec(raw);
  if (m?.[1]) return m[1];
  // Bare slug forms: "contains-duplicate/" or "contains-duplicate"
  const bare = raw.trim().replace(/^\/+|\/+$/g, "").split(/[?#]/)[0];
  return bare && bare.length > 0 ? bare : null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": "prep-local/0.1" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function ingestCatalog(): Promise<number> {
  console.log("[ingest] fetching problem catalog…");
  const questions = await fetchCatalog((n, total) => {
    if (n % 1000 === 0 || n === total) console.log(`[ingest]   ${n}/${total}`);
  });

  const insert = db.query(
    `INSERT INTO problems (qid, slug, title, difficulty, paid_only, ac_rate, topics)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(qid) DO UPDATE SET
       slug = excluded.slug, title = excluded.title, difficulty = excluded.difficulty,
       paid_only = excluded.paid_only, ac_rate = excluded.ac_rate, topics = excluded.topics`,
  );

  db.transaction(() => {
    for (const q of questions) {
      const qid = Number.parseInt(q.questionFrontendId, 10);
      if (!Number.isFinite(qid)) continue;
      insert.run(
        qid,
        q.titleSlug,
        q.title,
        q.difficulty,
        q.isPaidOnly ? 1 : 0,
        q.acRate,
        q.topicTags.map((t) => t.slug).join(","),
      );
    }
  })();

  console.log(`[ingest] catalog: ${questions.length} problems`);
  setMeta("catalog_ingested_at", new Date().toISOString());
  return questions.length;
}

/** Resolve slugs → qids against the local catalog, reporting anything unmatched. */
function addMemberships(listName: string, slugs: Array<string | null>, label: string): number {
  const lookup = db.query<{ qid: number }, [string]>("SELECT qid FROM problems WHERE slug = ?");
  const insert = db.query(
    "INSERT OR IGNORE INTO lists (name, qid, position) VALUES (?, ?, ?)",
  );

  let matched = 0;
  const missing: string[] = [];

  db.transaction(() => {
    slugs.forEach((slug, position) => {
      if (!slug) return;
      const row = lookup.get(slug);
      if (!row) {
        missing.push(slug);
        return;
      }
      insert.run(listName, row.qid, position);
      matched++;
    });
  })();

  const pct = slugs.length > 0 ? Math.round((matched / slugs.length) * 100) : 0;
  console.log(`[ingest] ${listName.padEnd(16)} ${matched}/${slugs.length} (${pct}%)  ${label}`);
  if (missing.length > 0 && missing.length <= 10) {
    console.log(`[ingest]   unmatched: ${missing.join(", ")}`);
  } else if (missing.length > 10) {
    console.log(`[ingest]   unmatched: ${missing.slice(0, 10).join(", ")} … +${missing.length - 10} more`);
  }

  return matched;
}

export async function ingestNeetCode(): Promise<void> {
  console.log("[ingest] fetching NeetCode data…");
  const nc = await fetchJson<NcEntry[]>(NEETCODE_DATA_URL);

  const blind75 = nc.filter((e) => e.blind75).map((e) => leetcodeSlug(e.link));
  const nc150 = nc.filter((e) => e.neetcode150).map((e) => leetcodeSlug(e.link));
  const ncAll = nc.map((e) => leetcodeSlug(e.link));

  addMemberships("blind75", blind75, "neetcode-gh blind75 flag");
  addMemberships("neetcode150", nc150, "neetcode-gh neetcode150 flag");
  addMemberships("neetcodeAll", ncAll, "neetcode-gh (all rows)");

  const nc250raw = await fetchJson<{ problems: Nc250Entry[] }>(NC250_URL);
  // Join on the LeetCode URL, NOT the NeetCode slug — see the header comment.
  const nc250 = nc250raw.problems.map((p) => leetcodeSlug(p.leetcode_url) ?? p.slug);
  addMemberships("neetcode250", nc250, "ascherj, joined via leetcode_url");
}

export async function ingestStudyPlans(): Promise<void> {
  for (const { slug, name } of STUDY_PLANS) {
    const plan = await fetchStudyPlan(slug);
    if (!plan) {
      console.warn(`[ingest] study plan '${slug}' returned null — wrong slug?`);
      continue;
    }
    addMemberships(name, plan.slugs, `LeetCode study plan "${plan.name}"`);
  }
}

export async function ingestAll(): Promise<void> {
  const started = Date.now();
  migrate();

  await ingestCatalog();
  await ingestNeetCode();
  await ingestStudyPlans();

  setMeta("ingested_at", new Date().toISOString());

  const summary = db
    .query<{ name: string; n: number }, []>(
      "SELECT name, COUNT(*) AS n FROM lists GROUP BY name ORDER BY n DESC",
    )
    .all();
  const distinct = db
    .query<{ n: number }, []>("SELECT COUNT(DISTINCT qid) AS n FROM lists")
    .get();
  const total = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM problems").get();

  console.log(`\n[ingest] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`[ingest] lists:`);
  for (const l of summary) console.log(`[ingest]   ${l.name.padEnd(18)} ${l.n}`);
  console.log(`[ingest]   ${"DISTINCT".padEnd(18)} ${distinct?.n ?? 0} / ${total?.n ?? 0} catalog`);
}

if (import.meta.main) {
  await ingestAll();
}
