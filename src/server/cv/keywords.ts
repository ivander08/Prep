/**
 * Keyword coverage against a pasted job description.
 *
 * The point of this feature is to SHOW A GAP, never to fill it. Auto-inserting terms the user
 * cannot defend is the exact failure mode an ATS-optimised CV invites, and it is the same rule the
 * tutor follows: the app states what is missing and leaves the writing to the person who has to
 * answer for it in the interview.
 *
 * Extraction is deliberately simple — frequency and length over unigrams and adjacent bigrams — and
 * deliberately deterministic. A model call here would make the same paste produce a different list
 * on every render, which is useless as a checklist.
 */

import type { CvDoc } from "./doc.ts";

/**
 * Recruiter boilerplate and function words.
 *
 * Roughly 120 entries. Every one of these is common in a posting and carries no signal about what
 * the role actually needs, so leaving them in would pad the list with terms the user already has.
 */
const STOPWORDS: Record<string, true> = {
  a: true, able: true, about: true, above: true, across: true, all: true, also: true, an: true,
  and: true, any: true, are: true, as: true, at: true, be: true, because: true, been: true,
  before: true, being: true, below: true, between: true, both: true, but: true, by: true,
  can: true, candidate: true, candidates: true, collaborate: true, communication: true,
  company: true, contribute: true, could: true, day: true, deep: true, demonstrated: true,
  do: true, does: true, during: true, each: true, either: true, etc: true, every: true,
  excellent: true, experience: true, experiences: true, familiar: true, familiarity: true,
  for: true, from: true, get: true, good: true, great: true, had: true, has: true, have: true,
  having: true, he: true, her: true, here: true, him: true, his: true, how: true, however: true,
  if: true, in: true, including: true, into: true, is: true, it: true, its: true, join: true,
  knowledge: true, like: true, look: true, looking: true, made: true, make: true, many: true,
  may: true, minimum: true, more: true, most: true, must: true, need: true, needed: true,
  new: true, not: true, of: true, on: true, one: true, only: true, or: true, other: true,
  our: true, out: true, over: true, own: true, plus: true, preferred: true, proficiency: true,
  proficient: true, provide: true, requirements: true, responsible: true, responsibilities: true,
  role: true, s: true, seeking: true, should: true, skill: true, skills: true, so: true,
  some: true, strong: true, such: true, support: true, t: true, team: true, teams: true,
  than: true, that: true, the: true, their: true, them: true, then: true, there: true, these: true,
  they: true, this: true, those: true, through: true, to: true, under: true, understand: true,
  up: true, us: true, use: true, using: true, very: true, was: true, we: true, well: true,
  were: true, what: true, when: true, where: true, which: true, while: true, who: true,
  will: true, with: true, within: true, work: true, working: true, would: true, years: true,
  you: true, your: true,
};

/**
 * Split into terms, keeping `+`, `#`, `.` and `/` inside a word.
 *
 * Without this `c++`, `c#`, `node.js` and `ci/cd` would be shredded into `c`, `node`, `js`, `ci`
 * and `cd` — the exact terms a job description is most likely to name and the ones a candidate
 * most needs to see covered.
 *
 * Only LEADING punctuation and a TRAILING `.`/`/` are stripped. Stripping a trailing `+` or `#`
 * would turn `c++` into `c` and `c#` into `c`, which is the shredding this exists to prevent.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#./]+/)
    .map((t) => t.replace(/^[./+#]+/, "").replace(/[./]+$/, ""))
    .filter((t) => t.length >= 2 && !STOPWORDS[t]);
}

/**
 * The top terms in a body of text, by frequency then length.
 *
 * Unigrams are the terms; a bigram is added only when the SAME phrase appears more than once.
 * A phrase repeated in a posting is a real requirement ("distributed systems" twice), whereas
 * every sentence produces incidental bigrams ("include understanding", "engineer postgresql") and
 * including those buried the single-word technologies — `c++`, `kubernetes`, `docker` — that the
 * feature exists to surface.
 */
export function extractKeywords(text: string, limit = 40): string[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];

  const counts = new Map<string, number>();

  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (let i = 0; i + 1 < tokens.length; i++) {
    const phrase = `${tokens[i]} ${tokens[i + 1]}`;
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }

  // Frequency descending, then length descending: a term mentioned twice beats a longer one
  // mentioned once, and among equals the longer term is the more specific one.
  return [...counts.entries()]
    .filter(([term, n]) => !term.includes(" ") || n > 1)
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : b[0].length - a[0].length))
    .map(([term]) => term)
    .slice(0, limit);
}

export type KeywordRow = { term: string; present: boolean; inSummary: boolean; inSkills: boolean };

/** All the text a CV actually contains, as one lowercase haystack. */
function docText(doc: CvDoc): string {
  return [
    doc.name,
    doc.headline ?? "",
    doc.summary ?? "",
    ...doc.skills.flatMap((g) => [g.label, ...g.items]),
    ...doc.sections.flatMap((s) => [s.title, ...s.entries.flatMap((e) => [e.role, e.org, ...e.bullets])]),
  ]
    .join("\n")
    .toLowerCase();
}

/**
 * Which of the posting's terms the CV already covers.
 *
 * `present` is a substring test on the whole document, case-insensitive. `inSummary` and `inSkills`
 * are reported separately because WHERE a term appears changes what the user should do about a
 * missing one: a technology belongs in Skills, an outcome belongs in a bullet.
 */
export function jdCoverage(jd: string, doc: CvDoc): { rows: KeywordRow[]; covered: number; total: number } {
  const terms = extractKeywords(jd, 40);
  const haystack = docText(doc);
  const summary = (doc.summary ?? "").toLowerCase();
  const skills = doc.skills.flatMap((g) => g.items).join(" ").toLowerCase();

  const rows = terms.map((term) => ({
    term,
    present: haystack.includes(term),
    inSummary: summary.includes(term),
    inSkills: skills.includes(term),
  }));

  return { rows, covered: rows.filter((r) => r.present).length, total: rows.length };
}
