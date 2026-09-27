/**
 * Pattern mapping and company tags.
 *
 * PATTERNS come from `neetcode-gh/leetcode`'s `.problemSiteData.json`, which carries the
 * roadmap category per problem ("Arrays & Hashing", "Sliding Window", ...). This is
 * distinct from LeetCode's own `topics` column: topics is a flat set of tags, while
 * `pattern` is the single technique family the roadmap teaches. Mastery is tracked per
 * pattern because patterns transfer and individual problems do not — that is the whole
 * argument for reviewing at pattern level.
 *
 * The join is on the LeetCode slug taken from the entry's `link` field, NOT on the
 * NeetCode slug, because NeetCode renames problems (74 of 250 NC250 entries differ).
 *
 * COMPANY TAGS come from `liquidslr/leetcode-company-wise-problems` (470 companies). Each
 * company directory has a `5. All.csv` with `Difficulty,Title,Frequency,Acceptance
 * Rate,Link,Topics`. The Link column gives the authoritative LeetCode slug; titles differ
 * in punctuation and casing so joining on title would miss rows.
 */

import { db, migrate } from "./db.ts";

const NEETCODE_DATA_URL =
  "https://raw.githubusercontent.com/neetcode-gh/leetcode/main/.problemSiteData.json";
const COMPANY_REPO = "liquidslr/leetcode-company-wise-problems";

type NcEntry = { link: string; pattern?: string; problem: string };

function leetcodeSlug(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = /\/problems\/([^/?#]+)/.exec(raw);
  if (m?.[1]) return m[1];
  const bare = raw.trim().replace(/^\/+|\/+$/g, "").split(/[?#]/)[0];
  return bare && bare.length > 0 ? bare : null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": "prep-local/0.1" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Assign a roadmap pattern to each problem that has one. */
export async function ingestPatterns(): Promise<{ tagged: number; patterns: number }> {
  console.log("[patterns] fetching NeetCode roadmap data…");
  const entries = await fetchJson<NcEntry[]>(NEETCODE_DATA_URL);

  const lookup = db.query<{ qid: number }, [string]>("SELECT qid FROM problems WHERE slug = ?");
  const update = db.query("UPDATE problems SET pattern = ? WHERE qid = ?");

  let tagged = 0;
  const patterns = new Set<string>();

  db.transaction(() => {
    for (const e of entries) {
      if (!e.pattern) continue;
      const slug = leetcodeSlug(e.link);
      if (!slug) continue;
      const row = lookup.get(slug);
      if (!row) continue;
      update.run(e.pattern, row.qid);
      patterns.add(e.pattern);
      tagged++;
    }
  })();

  console.log(`[patterns] tagged ${tagged} problems across ${patterns.size} patterns`);
  return { tagged, patterns: patterns.size };
}

/** Company directories in the repo, excluding non-company entries. */
async function listCompanies(): Promise<string[]> {
  const res = await fetch(`https://api.github.com/repos/${COMPANY_REPO}/contents/`, {
    headers: {
      "User-Agent": "prep-local/0.1",
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`GitHub contents → HTTP ${res.status}`);
  const body = (await res.json()) as Array<{ type: string; name: string }>;
  return body.filter((x) => x.type === "dir" && x.name !== ".github").map((x) => x.name);
}

/** Minimal CSV row splitter that respects double-quoted fields. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Ingest company → problem associations.
 *
 * `limit` caps how many companies to fetch, because this is 470 HTTP requests. The default
 * covers the ones people actually interview at; pass a higher number for the long tail.
 */
export async function ingestCompanies(
  limit = 60,
  onProgress?: (done: number, total: number, company: string) => void,
): Promise<{ companies: number; rows: number }> {
  console.log("[companies] listing companies…");
  const all = await listCompanies();

  // The repo's directory order is alphabetical; sort by how likely a company is to matter
  // is not possible without data, so take the alphabetically-first `limit` plus a known
  // set of common interviewers.
  const PRIORITY = [
    "Amazon", "Google", "Microsoft", "Meta", "Apple", "Netflix", "Adobe", "Uber",
    "Bloomberg", "ByteDance", "Tesla", "Nvidia", "Salesforce", "Oracle", "Goldman Sachs",
    "Flipkart", "Walmart Labs", "Atlassian", "Stripe", "Airbnb", "LinkedIn", "Twitter",
    "Snapchat", "Spotify", "DoorDash", "Instacart", "PayPal", "VMware", "Cisco", "Intel",
  ];
  const selected = [
    ...PRIORITY.filter((c) => all.includes(c)),
    ...all.filter((c) => !PRIORITY.includes(c)).slice(0, Math.max(0, limit - PRIORITY.length)),
  ];

  const lookup = db.query<{ qid: number }, [string]>("SELECT qid FROM problems WHERE slug = ?");
  const insert = db.query(
    "INSERT OR REPLACE INTO company_problems (company, qid, frequency) VALUES (?, ?, ?)",
  );

  let rows = 0;
  let done = 0;
  const missingSlugs = new Set<string>();

  for (const company of selected) {
    done++;
    onProgress?.(done, selected.length, company);

    const url = `https://raw.githubusercontent.com/${COMPANY_REPO}/main/${encodeURIComponent(company)}/5.%20All.csv`;
    let text: string;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "prep-local/0.1" }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      text = await res.text();
    } catch {
      continue;
    }

    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    // First line is the header: Difficulty,Title,Frequency,Acceptance Rate,Link,Topics
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i] ?? "");
      if (cols.length < 5) continue;
      const frequency = Number.parseFloat(cols[2] ?? "");
      const slug = leetcodeSlug(cols[4]);
      if (!slug) continue;

      const row = lookup.get(slug);
      if (!row) {
        missingSlugs.add(slug);
        continue;
      }
      insert.run(company, row.qid, Number.isFinite(frequency) ? frequency : null);
      rows++;
    }
  }

  console.log(`[companies] ${selected.length} companies, ${rows} associations`);
  if (missingSlugs.size > 0) {
    console.log(`[companies] ${missingSlugs.size} slugs not in the catalog (premium or renamed)`);
  }
  return { companies: selected.length, rows };
}

export async function ingestPhase3(companyLimit = 60): Promise<void> {
  const started = Date.now();
  migrate();
  await ingestPatterns();
  await ingestCompanies(companyLimit);

  const summary = db
    .query<{ n: number }, []>("SELECT COUNT(DISTINCT pattern) AS n FROM problems WHERE pattern IS NOT NULL")
    .get();
  const companies = db
    .query<{ n: number }, []>("SELECT COUNT(DISTINCT company) AS n FROM company_problems")
    .get();

  console.log(`\n[phase3] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`[phase3] patterns: ${summary?.n ?? 0} | companies: ${companies?.n ?? 0}`);
}

if (import.meta.main) {
  const limit = Number(process.argv[2] ?? 60);
  await ingestPhase3(limit);
}
