import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

type CompanyRow = { company: string; n: number };

type CompanyProblem = {
  qid: number;
  slug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  frequency: number | null;
  pattern: string | null;
  solved: number;
};

/**
 * Company-tagged practice.
 *
 * Tag data comes from a community mirror, not LeetCode (whose `companyTags` field returns
 * null without an authenticated premium session). It can be stale, and the frequency score
 * is whatever the mirror recorded — useful for ordering, not a promise about any specific
 * company's current loop.
 */
export function CompaniesView({ onOpen }: { onOpen: (slug: string) => void }) {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [problems, setProblems] = useState<CompanyProblem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const loadCompanies = useCallback(async () => {
    try {
      const r = await api<{ companies: CompanyRow[] }>("/api/companies");
      setCompanies(r.companies);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadProblems = useCallback(async (company: string) => {
    try {
      const r = await api<{ problems: CompanyProblem[] }>(
        `/api/companies/${encodeURIComponent(company)}/problems?limit=80`,
      );
      setProblems(r.problems);
      setActive(company);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  if (error) return <div className="notice bad">{error}</div>;

  if (companies.length === 0) {
    return (
      <>
        <h1>Companies</h1>
        <div className="card muted">
          No company tags loaded yet. Run{" "}
          <code>bun run src/server/patterns.ts 100</code> to ingest them — it fetches a CSV per company,
          so start with a small number.
        </div>
      </>
    );
  }

  const q = filter.trim().toLowerCase();
  const visible = q ? companies.filter((c) => c.company.toLowerCase().includes(q)) : companies;

  return (
    <>
      <h1>Companies</h1>
      <p className="muted">
        Ordered by how often each problem is reported. Sourced from a community mirror rather than
        LeetCode, so treat frequency as a hint about priority, not a promise.
      </p>

      <div className="company-layout">
        <div className="company-list">
          <input
            className="filter-input"
            placeholder="Filter companies…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="company-scroll">
            {visible.map((c) => (
              <button
                key={c.company}
                className={`company-item${active === c.company ? " active" : ""}`}
                onClick={() => void loadProblems(c.company)}
              >
                <span>{c.company}</span>
                <span className="muted small">{c.n}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="company-problems">
          {active ? (
            <>
              <h2>{active}</h2>
              {problems.map((p) => (
                <div
                  key={p.qid}
                  className={`problem-row${p.solved ? " solved" : ""}`}
                  onClick={() => onOpen(p.slug)}
                >
                  <span className="qid">{p.qid}</span>
                  <span className="title">
                    {p.title}
                    {p.pattern ? <span className="muted small"> · {p.pattern}</span> : null}
                  </span>
                  <span className="row" style={{ gap: 8 }}>
                    {p.frequency !== null ? (
                      <span className="muted small mono" title="reported frequency">
                        {p.frequency.toFixed(0)}
                      </span>
                    ) : null}
                    <span className={`badge ${p.difficulty}`}>{p.difficulty}</span>
                  </span>
                </div>
              ))}
            </>
          ) : (
            <div className="empty">Pick a company.</div>
          )}
        </div>
      </div>
    </>
  );
}
