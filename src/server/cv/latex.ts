/**
 * LaTeX rendering, and the escaping that makes it safe.
 *
 * Every decision in the template is an ATS requirement rather than a decoration, and the preamble
 * is the load-bearing part:
 *   - `\usepackage[T1]{fontenc}` + `\usepackage{lmodern}` + `\usepackage{cmap}` are what keep the
 *     text layer extractable. Measured: without them a compiled CV loses its bullet glyph and
 *     emits a Type 3 font with `uni=no`, so `pdffonts` fails and ligature words ("financial",
 *     "efficient", "workflow") stop matching in `pdftotext`.
 *   - One column, no `multicol`, no sidebars: a two-column template scrambles extraction order.
 *   - Plain-text headings and a pipe-separated contact line with no icon fonts: an icon extracts as
 *     junk glued to the email and breaks contact detection.
 *   - Dates on the title line via `\hfill`, never a separate column.
 */

import type { CvDoc } from "./doc.ts";

/**
 * LaTeX's special characters, as one map.
 *
 * `escapeLatex` applies this in a SINGLE PASS over the characters. Chained `.replace` calls would
 * be wrong: replacing `\` first and then `{`/`}` would escape the braces inside the replacement
 * text itself and emit `\textbackslash\{\}` instead of `\textbackslash{}`.
 */
const LATEX_ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  "$": "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

/** Escape a string for LaTeX text. Single pass; see `LATEX_ESCAPES`. */
export function escapeLatex(s: string): string {
  let out = "";
  for (const ch of s) out += LATEX_ESCAPES[ch] ?? ch;
  return out;
}

/**
 * Escape a URL for hyperref's argument.
 *
 * `~` and `^` are percent-encoded first, so the escape map never sees them: hyperref accepts
 * `\%`, `\#`, `\_` and `\&` inside a URL, but `\textasciitilde{}` there would be printed literally.
 * The order matters — encode, then escape.
 */
function escapeUrl(url: string): string {
  const encoded = url.replace(/~/g, "%7E").replace(/\^/g, "%5E");
  return escapeLatex(encoded);
}

/** `Start -- End`, or whichever half exists. Empty when neither does. */
function dateRange(start: string, end: string): string {
  if (start.length > 0 && end.length > 0) return `${start} -- ${end}`;
  return start || end;
}

/**
 * The document body, with the ATS requirements applied in order.
 *
 * The preamble is fixed. The body is: name, contact line, optional summary, `doc.sections` in array
 * order (the UI owns the order), then `Skills` last from `doc.skills`.
 */
export function renderLatex(doc: CvDoc): string {
  const lines: string[] = [];

  lines.push("\\documentclass[11pt,letterpaper]{article}");
  lines.push("\\usepackage[T1]{fontenc}");
  lines.push("\\usepackage{lmodern}");
  lines.push("\\usepackage{cmap}");
  lines.push("\\usepackage[margin=0.7in]{geometry}");
  lines.push("\\usepackage{enumitem}");
  lines.push("\\usepackage[hidelinks]{hyperref}");
  lines.push("\\pagestyle{empty}");
  lines.push("\\setlength{\\parindent}{0pt}");
  lines.push("\\newcommand{\\cvname}[1]{{\\LARGE\\bfseries #1}\\par\\vspace{2pt}}");
  lines.push("\\newcommand{\\cvcontact}[1]{{\\small #1}\\par\\vspace{6pt}}");
  lines.push("\\newcommand{\\cvsection}[1]{\\vspace{8pt}{\\large\\bfseries #1}\\par\\vspace{2pt}\\hrule\\vspace{4pt}}");
  lines.push("\\newcommand{\\cventry}[3]{\\textbf{#1} --- #2 \\hfill #3\\par}");
  lines.push("\\begin{document}");
  lines.push("");

  lines.push(`\\cvname{${escapeLatex(doc.name)}}`);
  if (doc.headline) lines.push(`{\\small\\itshape ${escapeLatex(doc.headline)}}\\par\\vspace{2pt}`);

  // Plain text, pipe-separated, no icons. Every part is conditional so a missing phone does not
  // leave a dangling separator.
  const contact: string[] = [escapeLatex(doc.email)];
  if (doc.phone) contact.push(escapeLatex(doc.phone));
  if (doc.location) contact.push(escapeLatex(doc.location));
  for (const l of doc.links) {
    const label = escapeLatex(l.label || l.url);
    let href: string | null = null;
    try {
      new URL(l.url);
      href = l.url;
    } catch {
      // An invalid URL renders as a plain label. Dropping the link is better than emitting a
      // `\href` hyperref will reject, which would fail the whole compile.
    }
    contact.push(href ? `\\href{${escapeUrl(href)}}{${label}}` : label);
  }
  lines.push(`\\cvcontact{${contact.join(" $|$ ")}}`);

  if (doc.summary) {
    lines.push(escapeLatex(doc.summary));
    lines.push("");
  }

  for (const section of doc.sections) {
    // `Skills` is rendered from `doc.skills` below, whether or not it also appears here, so it is
    // skipped to avoid rendering it twice.
    if (section.title.toLowerCase() === "skills") continue;
    if (section.entries.length === 0) continue;

    lines.push(`\\cvsection{${escapeLatex(section.title)}}`);
    for (const e of section.entries) {
      const dates = dateRange(e.start, e.end);
      // Role and org, with the dates on the SAME line via `\hfill` inside `\cventry`. A separate
      // date column is what an ATS reads as a different field.
      lines.push(`\\cventry{${escapeLatex(e.role)}}{${escapeLatex(e.org)}}{${escapeLatex(dates)}}`);
      if (e.location) lines.push(`{\\small ${escapeLatex(e.location)}}\\par`);
      if (e.bullets.length > 0) {
        lines.push("\\begin{itemize}[leftmargin=*]");
        for (const b of e.bullets) lines.push(`  \\item ${escapeLatex(b)}`);
        lines.push("\\end{itemize}");
      }
      lines.push("");
    }
  }

  if (doc.skills.length > 0) {
    lines.push("\\cvsection{Skills}");
    for (const group of doc.skills) {
      if (group.items.length === 0) continue;
      lines.push(`\\textbf{${escapeLatex(group.label)}}: ${escapeLatex(group.items.join(", "))}\\par`);
    }
  }

  lines.push("");
  lines.push("\\end{document}");
  return lines.join("\n") + "\n";
}
