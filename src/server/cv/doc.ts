/**
 * The CV document model and its hand-written shape check.
 *
 * A hand-written validator rather than a schema library: the repo has none and adds none, and the
 * rules here are a dozen field checks with length caps. The caps are load-bearing — a pasted essay
 * in a bullet field would otherwise render a twelve-page PDF, and the length limits are the only
 * thing standing between a paste and that.
 */

export type CvLink = { label: string; url: string };

export type CvEntry = {
  /** Company / school. */
  org: string;
  /** Title / degree. */
  role: string;
  location?: string;
  /** Free text, e.g. "Jan 2023". Not a date type: CVs write dates many ways and parsing them buys
   * nothing the renderer needs. */
  start: string;
  /** Free text, e.g. "Present". */
  end: string;
  bullets: string[];
};

export type CvDoc = {
  name: string;
  headline?: string;
  email: string;
  phone?: string;
  location?: string;
  links: CvLink[];
  summary?: string;
  sections: Array<{ title: string; entries: CvEntry[] }>;
  skills: Array<{ label: string; items: string[] }>;
};

/** The section titles a new document starts with, in order, and what the editor offers. */
export const CANONICAL_SECTIONS = ["Education", "Experience", "Projects", "Skills"] as const;

/** Field caps. Every one of these is a paste guard, not a preference. */
const CAPS = {
  name: 80,
  headline: 80,
  email: 120,
  phone: 40,
  location: 80,
  linkLabel: 40,
  linkUrl: 300,
  summary: 600,
  sectionTitle: 60,
  org: 120,
  role: 120,
  entryLocation: 80,
  date: 40,
  bullet: 400,
  skillLabel: 40,
  skillItem: 60,
} as const;

const MAX_SECTIONS = 10;
const MAX_ENTRIES = 30;
const MAX_BULLETS = 30;
const MAX_SKILL_GROUPS = 12;
const MAX_SKILL_ITEMS = 40;
const MAX_LINKS = 8;

function str(value: unknown, cap: number): string {
  return typeof value === "string" ? value.trim().slice(0, cap) : "";
}

function optionalStr(value: unknown, cap: number): string | undefined {
  const s = str(value, cap);
  return s.length > 0 ? s : undefined;
}

/** A new document with one empty entry under each canonical section. */
export function emptyDoc(name: string): CvDoc {
  return {
    name: str(name, CAPS.name) || "Your Name",
    headline: undefined,
    email: "",
    phone: undefined,
    location: undefined,
    links: [],
    summary: undefined,
    sections: CANONICAL_SECTIONS.map((title) => ({
      title,
      entries: [emptyEntry()],
    })),
    skills: [{ label: "Languages", items: [] }],
  };
}

export function emptyEntry(): CvEntry {
  return { org: "", role: "", location: undefined, start: "", end: "", bullets: [""] };
}

/**
 * Validate and normalise a document.
 *
 * Normalises rather than only checking: every string is trimmed and capped, arrays are truncated,
 * and unknown keys are dropped. A `PUT` therefore cannot store a document the renderer would choke
 * on, and the client's JSON import path gets the same treatment through the same call.
 *
 * `errors` names the fields that failed, so the UI can say what to fix rather than "invalid".
 */
export function validateDoc(value: unknown): { ok: true; value: CvDoc } | { ok: false; errors: string[] } {
  if (typeof value !== "object" || value === null) return { ok: false, errors: ["doc must be an object"] };
  const v = value as Record<string, unknown>;
  const errors: string[] = [];

  const name = str(v.name, CAPS.name);
  if (name.length === 0) errors.push("name is required");

  const email = str(v.email, CAPS.email);
  if (email.length === 0) errors.push("email is required");

  const links: CvLink[] = [];
  if (Array.isArray(v.links)) {
    for (const raw of v.links.slice(0, MAX_LINKS)) {
      if (typeof raw !== "object" || raw === null) continue;
      const l = raw as Record<string, unknown>;
      const label = str(l.label, CAPS.linkLabel);
      const url = str(l.url, CAPS.linkUrl);
      if (label.length === 0 && url.length === 0) continue;
      links.push({ label, url });
    }
  }

  const sections: CvDoc["sections"] = [];
  if (Array.isArray(v.sections)) {
    for (const raw of v.sections.slice(0, MAX_SECTIONS)) {
      if (typeof raw !== "object" || raw === null) continue;
      const s = raw as Record<string, unknown>;
      const title = str(s.title, CAPS.sectionTitle);
      if (title.length === 0) continue;

      const entries: CvEntry[] = [];
      if (Array.isArray(s.entries)) {
        for (const eRaw of s.entries.slice(0, MAX_ENTRIES)) {
          if (typeof eRaw !== "object" || eRaw === null) continue;
          const e = eRaw as Record<string, unknown>;
          const bullets = Array.isArray(e.bullets)
            ? e.bullets
                .map((b) => str(b, CAPS.bullet))
                .filter((b) => b.length > 0)
                .slice(0, MAX_BULLETS)
            : [];
          const org = str(e.org, CAPS.org);
          const role = str(e.role, CAPS.role);
          // An entry with neither an org nor a role nor a bullet is an empty row the user added and
          // did not fill in; keeping it renders a stray date line with nothing on it.
          if (org.length === 0 && role.length === 0 && bullets.length === 0) continue;
          entries.push({
            org,
            role,
            location: optionalStr(e.location, CAPS.entryLocation),
            start: str(e.start, CAPS.date),
            end: str(e.end, CAPS.date),
            bullets,
          });
        }
      }
      sections.push({ title, entries });
    }
  }

  const skills: CvDoc["skills"] = [];
  if (Array.isArray(v.skills)) {
    for (const raw of v.skills.slice(0, MAX_SKILL_GROUPS)) {
      if (typeof raw !== "object" || raw === null) continue;
      const g = raw as Record<string, unknown>;
      const label = str(g.label, CAPS.skillLabel);
      const items = Array.isArray(g.items)
        ? g.items
            .map((i) => str(i, CAPS.skillItem))
            .filter((i) => i.length > 0)
            .slice(0, MAX_SKILL_ITEMS)
        : [];
      if (label.length === 0 && items.length === 0) continue;
      skills.push({ label, items });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      headline: optionalStr(v.headline, CAPS.headline),
      email,
      phone: optionalStr(v.phone, CAPS.phone),
      location: optionalStr(v.location, CAPS.location),
      links,
      summary: optionalStr(v.summary, CAPS.summary),
      sections,
      skills,
    },
  };
}
