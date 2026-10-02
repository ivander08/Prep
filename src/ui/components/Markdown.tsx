import { useMemo } from "react";

/**
 * Minimal markdown renderer: headings, paragraphs, lists, fenced code, inline code, bold/italic.
 *
 * Hand-rolled, not a dependency: the subset used by LeetCode statements, concept prose and the
 * generated project study documents is small and fixed, and a full markdown parser would be the
 * largest dependency in the app to render `**bold**` and a fenced block.
 *
 * Headings were added when the project study documents arrived: those are REQUIRED to carry six
 * `##` sections, and without this they rendered as the literal text `## How it works`. Only `#`
 * through `###` are recognised, which is all the generator emits.
 *
 * Shared by the problem statement, the official hints, the fundamentals track and the project
 * modules. It was private to App.tsx until the concepts view needed it, at which point a second
 * renderer would have been the wrong answer.
 */
export function Markdown({ md }: { md: string }) {
  const blocks = useMemo(() => {
    const out: Array<{ kind: "p" | "ul" | "pre"; content: string; level?: number }> = [];
    const lines = md.split("\n");
    let buf: string[] = [];
    let list: string[] = [];
    let pre: string[] = [];
    let inPre = false;

    const flushP = () => {
      if (buf.length) {
        out.push({ kind: "p", content: buf.join(" ") });
        buf = [];
      }
    };
    const flushList = () => {
      if (list.length) {
        out.push({ kind: "ul", content: list.join("\n") });
        list = [];
      }
    };

    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        if (inPre) {
          out.push({ kind: "pre", content: pre.join("\n") });
          pre = [];
          inPre = false;
        } else {
          flushP();
          flushList();
          inPre = true;
        }
        continue;
      }
      if (inPre) {
        pre.push(line);
        continue;
      }

      const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
      if (heading) {
        flushP();
        flushList();
        out.push({ kind: "p", content: heading[2]!.trim(), level: heading[1]!.length });
        continue;
      }

      if (line.trim().startsWith("- ")) {
        flushP();
        list.push(line.trim().slice(2));
        continue;
      }
      if (line.trim() === "") {
        flushP();
        flushList();
        continue;
      }
      flushList();
      buf.push(line.trim());
    }
    flushP();
    flushList();
    if (pre.length) out.push({ kind: "pre", content: pre.join("\n") });
    return out;
  }, [md]);

  return (
    <div>
      {blocks.map((b, i) => {
        if (b.kind === "pre") {
          return (
            <pre key={i}>
              <code>{b.content}</code>
            </pre>
          );
        }
        if (b.kind === "ul") {
          return (
            <ul key={i}>
              {b.content.split("\n").map((li, j) => (
                <li key={j}>{inline(li)}</li>
              ))}
            </ul>
          );
        }
        // A heading is a paragraph with a level; the tag follows, so `##` inside a generated study
        // document reads as a section rather than as two literal hash marks.
        if (b.level === 1) return <h1 key={i}>{inline(b.content)}</h1>;
        if (b.level === 2) return <h2 key={i}>{inline(b.content)}</h2>;
        if (b.level === 3) return <h3 key={i}>{inline(b.content)}</h3>;
        return <p key={i}>{inline(b.content)}</p>;
      })}
    </div>
  );
}

function inline(text: string) {
  // Bold before italic: the italic pattern must not consume the inner span of `**bold**`.
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter((p) => p.length > 0);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("*") && p.endsWith("*")) return <em key={i}>{p.slice(1, -1)}</em>;
    return <span key={i}>{p}</span>;
  });
}
