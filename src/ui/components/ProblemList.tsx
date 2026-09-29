import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Row } from "./Row";

export type ListProblem = {
  qid: number;
  slug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  position: number;
  solved: number;
  pattern: string | null;
  topics: string | null;
  acRate: number | null;
  attempts: number;
  hintsUsed: number | null;
};

type SortKey = "position" | "difficulty" | "acceptance" | "title" | "attempts";
type GroupKey = "none" | "pattern" | "difficulty" | "status";

const DIFFICULTY_ORDER: Record<string, number> = { Easy: 0, Medium: 1, Hard: 2 };

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "position", label: "Roadmap order" },
  { key: "difficulty", label: "Difficulty" },
  { key: "acceptance", label: "Acceptance" },
  { key: "title", label: "Title" },
  { key: "attempts", label: "Attempts" },
];

const GROUPS: Array<{ key: GroupKey; label: string }> = [
  { key: "none", label: "No grouping" },
  { key: "pattern", label: "By technique" },
  { key: "difficulty", label: "By difficulty" },
  { key: "status", label: "By status" },
];

/**
 * Problem list with sorting, filtering, and grouping.
 *
 * Everything is derived client-side from one fetch, so changing a filter or sort does not
 * hit the network. The list is capped at 2000 rows server-side, which covers every curated
 * list (the largest is NeetCode All at 450).
 */
export function ProblemList({ listName, onOpen }: { listName: string; onOpen: (slug: string) => void }) {
  const [problems, setProblems] = useState<ListProblem[]>([]);
  const [sort, setSort] = useState<SortKey>("position");
  const [group, setGroup] = useState<GroupKey>("pattern");
  const [difficulty, setDifficulty] = useState<"all" | "Easy" | "Medium" | "Hard">("all");
  const [status, setStatus] = useState<"all" | "unsolved" | "solved" | "attempted">("all");
  const [pattern, setPattern] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (name: string) => {
    try {
      const r = await api<{ problems: ListProblem[] }>(`/api/lists/${name}/problems?limit=2000`);
      setProblems(r.problems);
      setPattern("all");
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load(listName);
  }, [listName, load]);

  const patterns = useMemo(() => {
    const set = new Set<string>();
    for (const p of problems) if (p.pattern) set.add(p.pattern);
    return [...set].sort();
  }, [problems]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = problems.filter((p) => {
      if (difficulty !== "all" && p.difficulty !== difficulty) return false;
      if (pattern !== "all" && p.pattern !== pattern) return false;
      if (status === "solved" && p.solved !== 1) return false;
      if (status === "unsolved" && p.solved === 1) return false;
      if (status === "attempted" && p.attempts === 0) return false;
      if (q && !p.title.toLowerCase().includes(q) && !String(p.qid).includes(q)) return false;
      return true;
    });

    const dir = sort === "title" ? 1 : 1;
    out.sort((a, b) => {
      switch (sort) {
        case "difficulty":
          return (DIFFICULTY_ORDER[a.difficulty] ?? 9) - (DIFFICULTY_ORDER[b.difficulty] ?? 9) || a.position - b.position;
        case "acceptance":
          return (b.acRate ?? 0) - (a.acRate ?? 0);
        case "title":
          return a.title.localeCompare(b.title) * dir;
        case "attempts":
          return b.attempts - a.attempts;
        default:
          return a.position - b.position;
      }
    });
    return out;
  }, [problems, difficulty, pattern, status, search, sort]);

  const grouped = useMemo(() => {
    if (group === "none") return [["", filtered]] as Array<[string, ListProblem[]]>;

    const keyOf = (p: ListProblem): string => {
      if (group === "pattern") return p.pattern ?? "Ungrouped";
      if (group === "difficulty") return p.difficulty;
      return p.solved === 1 ? "Solved" : p.attempts > 0 ? "Attempted" : "Not started";
    };

    const buckets = new Map<string, ListProblem[]>();
    for (const p of filtered) {
      const k = keyOf(p);
      const bucket = buckets.get(k) ?? [];
      bucket.push(p);
      buckets.set(k, bucket);
    }

    const entries = [...buckets.entries()];
    if (group === "difficulty") {
      entries.sort((a, b) => (DIFFICULTY_ORDER[a[0]] ?? 9) - (DIFFICULTY_ORDER[b[0]] ?? 9));
    } else if (group === "status") {
      const order = ["Not started", "Attempted", "Solved"];
      entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    }
    return entries;
  }, [filtered, group]);

  if (error) return <div className="notice bad">{error}</div>;

  const solvedCount = filtered.filter((p) => p.solved === 1).length;

  return (
    <>
      <div className="spread">
        <h1>{listName}</h1>
        <span className="mono muted small">
          {filtered.length} shown · {solvedCount} solved
        </span>
      </div>

      <div className="filters">
        <input
          className="filter-input"
          placeholder="Search title or number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <label className="field">
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Group</span>
          <select value={group} onChange={(e) => setGroup(e.target.value as GroupKey)}>
            {GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Difficulty</span>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}>
            <option value="all">All</option>
            <option value="Easy">Easy</option>
            <option value="Medium">Medium</option>
            <option value="Hard">Hard</option>
          </select>
        </label>

        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All</option>
            <option value="unsolved">Unsolved</option>
            <option value="attempted">Attempted</option>
            <option value="solved">Solved</option>
          </select>
        </label>

        <label className="field">
          <span>Technique</span>
          <select value={pattern} onChange={(e) => setPattern(e.target.value)}>
            <option value="all">All</option>
            {patterns.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">No problems match these filters.</div>
      ) : (
        grouped.map(([label, items]) => (
          <div key={label || "all"}>
            {label ? (
              <h2>
                {label}
                <span className="mono muted small" style={{ marginLeft: 10, letterSpacing: 0 }}>
                  {items.length}
                </span>
              </h2>
            ) : null}
            <div className="table">
              {items.map((p) => (
                <Row key={p.qid} className={p.solved ? "solved" : ""} onClick={() => onOpen(p.slug)}>
                  <span className="qid">{p.qid}</span>
                  <span className="title">
                    {p.title}
                    {group !== "pattern" && p.pattern ? (
                      <span className="muted small"> · {p.pattern}</span>
                    ) : null}
                  </span>
                  <span className="row" style={{ gap: 10 }}>
                    {p.attempts > 0 && p.solved === 0 ? (
                      <span className="mono muted small">{p.attempts}×</span>
                    ) : null}
                    <span className={`badge ${p.difficulty}`}>{p.difficulty}</span>
                  </span>
                </Row>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}
