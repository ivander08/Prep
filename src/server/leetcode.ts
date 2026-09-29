/**
 * LeetCode GraphQL client.
 *
 * Personal, single-user, local tool: statements are fetched on demand and cached in the
 * local SQLite file. Nothing is redistributed. See the dossier §10: the local-only decision
 * keeps this on the right side of LeetCode's ToS, whose robots.txt disallows /graphql.
 *
 * Two non-obvious facts, found by running the API:
 *   1. `__type` introspection is DISABLED ("Query unavailable"). Discover schema changes by
 *      trying fields.
 *   2. `companyTags` returns null unauthenticated: it is premium-gated.
 */

const ENDPOINT = "https://leetcode.com/graphql/";

const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Referer: "https://leetcode.com/problemset/",
  Origin: "https://leetcode.com",
};

export class LeetCodeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "LeetCodeError";
  }
}

export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new LeetCodeError(`HTTP ${res.status}`, res.status, text.slice(0, 500));
  }

  let json: { data?: T; errors?: Array<{ message: string }> };
  try {
    json = JSON.parse(text);
  } catch {
    throw new LeetCodeError("response was not JSON", res.status, text.slice(0, 500));
  }

  // LeetCode returns 200 with an `errors` array for bad queries. Throw instead: a problem
  // list that comes back empty and silent is much worse than a loud failure.
  if (json.errors?.length) {
    throw new LeetCodeError(json.errors.map((e) => e.message).join("; "), res.status, text.slice(0, 500));
  }
  if (json.data === undefined) {
    throw new LeetCodeError("response had no data", res.status, text.slice(0, 500));
  }

  return json.data;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type CatalogQuestion = {
  questionFrontendId: string;
  titleSlug: string;
  title: string;
  difficulty: string;
  isPaidOnly: boolean;
  acRate: number;
  topicTags: Array<{ slug: string }>;
};

const CATALOG_QUERY = `
query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    total: totalNum
    questions: data {
      questionFrontendId
      titleSlug
      title
      difficulty
      isPaidOnly
      acRate
      topicTags { slug }
    }
  }
}`;

const PAGE_SIZE = 100;
const POLITE_DELAY_MS = 350;

/**
 * Fetch the entire problem catalog, paginated.
 * Measured: 4,068 problems in ~37 s with a 350 ms delay between pages.
 */
export async function fetchCatalog(
  onProgress?: (fetched: number, total: number) => void,
): Promise<CatalogQuestion[]> {
  const out: CatalogQuestion[] = [];
  let skip = 0;
  let total = Infinity;

  while (skip < total) {
    const data = await gql<{
      problemsetQuestionList: { total: number; questions: CatalogQuestion[] };
    }>(CATALOG_QUERY, { categorySlug: "", limit: PAGE_SIZE, skip, filters: {} });

    const page = data.problemsetQuestionList;
    total = page.total;

    if (page.questions.length === 0) break;
    out.push(...page.questions);
    skip += PAGE_SIZE;

    onProgress?.(out.length, total);
    if (skip < total) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, POLITE_DELAY_MS);
      await promise;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Single problem
// ---------------------------------------------------------------------------

export type ProblemDetail = {
  questionFrontendId: string;
  title: string;
  difficulty: string;
  content: string | null;
  hints: string[] | null;
  codeSnippets: Array<{ langSlug: string; code: string }> | null;
  exampleTestcases: string | null;
  metaData: string | null;
};

const PROBLEM_QUERY = `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    difficulty
    content
    hints
    codeSnippets { langSlug code }
    exampleTestcases
    metaData
  }
}`;

export async function fetchProblem(titleSlug: string): Promise<ProblemDetail> {
  const data = await gql<{ question: ProblemDetail | null }>(PROBLEM_QUERY, { titleSlug });
  if (!data.question) throw new LeetCodeError(`problem not found: ${titleSlug}`, 404, "");
  return data.question;
}

// ---------------------------------------------------------------------------
// Study plans (LeetCode's own lists)
// ---------------------------------------------------------------------------

/**
 * NOTE: the field is `planSubGroups`, capital G. `planGroups` and `planSubgroups` both
 * error. The SQL plan's slug is `top-sql-50`; `sql-50` returns null with no error, so a
 * wrong slug looks like an empty plan.
 */
const STUDY_PLAN_QUERY = `
query studyPlanV2Detail($planSlug: String!) {
  studyPlanV2Detail(planSlug: $planSlug) {
    name
    questionNum
    planSubGroups {
      name
      questions { titleSlug }
    }
  }
}`;

export async function fetchStudyPlan(
  planSlug: string,
): Promise<{ name: string; slugs: string[] } | null> {
  const data = await gql<{
    studyPlanV2Detail: {
      name: string;
      questionNum: number;
      planSubGroups: Array<{ name: string; questions: Array<{ titleSlug: string }> | null }>;
    } | null;
  }>(STUDY_PLAN_QUERY, { planSlug });

  const plan = data.studyPlanV2Detail;
  if (!plan) return null;

  const slugs = (plan.planSubGroups ?? []).flatMap((g) => (g.questions ?? []).map((q) => q.titleSlug));
  return { name: plan.name, slugs };
}

// ---------------------------------------------------------------------------
// HTML → markdown
// ---------------------------------------------------------------------------

/**
 * LeetCode returns statements as HTML. The prompt prefix is built from this, so it needs
 * to be clean and small: measured 1,442 chars of HTML → 789 chars of markdown (~197
 * tokens) for Two Sum, a 55% reduction.
 *
 * Hand-rolled: the tag set is tiny and fixed, so a dependency is not worth it.
 */
/**
 * Convert an official hint to markdown.
 *
 * LeetCode returns hints as raw HTML fragments: `<code>x</code>`, `<strong>`, entities.
 * They were being stored and rendered verbatim, so a hint read "say <code>x</code>" instead
 * of "say `x`". Same converter as statements; a named export so the cached hints can be
 * re-converted without re-fetching.
 */
export function hintToMarkdown(html: string): string {
  return htmlToMarkdown(html);
}

export function htmlToMarkdown(input: string): string {
  let s = input;

  // Fenced code blocks first: <pre> content must survive tag stripping verbatim.
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, (_m, code: string) => {
    const inner = code
      .replace(/<code[^>]*>/g, "")
      .replace(/<\/code>/g, "")
      .replace(/<[^>]+>/g, "");
    return `\n\`\`\`\n${decodeEntities(inner).trim()}\n\`\`\`\n`;
  });

  // LeetCode nests emphasis: `<strong><em>one</em> solution</strong>`. Converting both levels
  // yields `***one* solution**`, valid CommonMark but more than a lightweight renderer should
  // parse for a statement view. Collapse the nesting: inside a bold span the italic is visually
  // redundant anyway. The `(.*?)` before `</strong>` catches the text after the inner `</em>`.
  s = s.replace(
    /<(strong|b)(\s[^>]*)?>\s*<(em|i)(\s[^>]*)?>(.*?)<\/\3>(.*?)<\/\1>/gs,
    "<$1>$5$6</$1>",
  );

  s = s.replace(/<sup[^>]*>/g, "^").replace(/<\/sup>/g, "");
  s = s.replace(/<sub[^>]*>/g, "_").replace(/<\/sub>/g, "");
  s = s.replace(/<li[^>]*>/g, "\n- ");
  s = s.replace(/<\/li>/g, "");
  s = s.replace(/<\/p>/g, "\n\n");
  s = s.replace(/<br\s*\/?>/g, "\n");
  s = s.replace(/<\/h[1-6]>/g, "\n\n");
  // Emphasis tags carry attributes in LeetCode's HTML, `<strong class="example">` being the
  // common one. Matching only the bare form left a stray `**`: the opening tag was stripped
  // as an unknown tag while the closing tag became emphasis markers.
  s = s.replace(/<(strong|b)(\s[^>]*)?>/g, "**").replace(/<\/(strong|b)>/g, "**");
  s = s.replace(/<(em|i)(\s[^>]*)?>/g, "*").replace(/<\/(em|i)>/g, "*");
  s = s.replace(/<code[^>]*>/g, "`").replace(/<\/code>/g, "`");
  s = s.replace(/<[^>]+>/g, "");

  s = decodeEntities(s);
  s = s.replace(/\u00a0/g, " ");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/ *\n */g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  le: "≤",
  ge: "≥",
  ne: "≠",
  times: "×",
  minus: "−",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent: string) => {
    if (ent.startsWith("#x") || ent.startsWith("#X")) {
      const n = Number.parseInt(ent.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    if (ent.startsWith("#")) {
      const n = Number.parseInt(ent.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[ent] ?? m;
  });
}
