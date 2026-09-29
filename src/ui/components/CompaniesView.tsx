import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Row } from "./Row";

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
 * is whatever the mirror recorded: useful for ordering, no promise about any specific
 * company's current loop.
 */
export function CompaniesView({ onOpen }: { onOpen: (slug: string) => void }) {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [problems, setProblems] = useState<CompanyProblem[]>([]);
  /** Failure of the PROBLEM list only. The company list must survive it, so it is not a full-page
   * return: a failed company load used to replace the whole view, list included, leaving nothing to
   * click and no way back. */
  const [problemsError, setProblemsError] = useState<string | null>(null);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [loadingProblems, setLoadingProblems] = useState(false);
  /**
   * Guards against an out-of-order response. Two rapid clicks issued two requests, and whichever
   * finished last won: A-then-B could leave A's list under B's header. The generation is bumped per
   * request, and a response whose generation is stale is dropped.
   */
  const generation = useRef(0);
  const [filter, setFilter] = useState("");

  const loadCompanies = useCallback(async () => {
    try {
      const r = await api<{ companies: CompanyRow[] }>("/api/companies");
      setCompanies(r.companies);
      setCompaniesError(null);
    } catch (e) {
      setCompaniesError(String(e));
    }
  }, []);

  const loadProblems = useCallback(async (company: string) => {
    const mine = ++generation.current;
    setLoadingProblems(true);
    setProblemsError(null);
    try {
      const r = await api<{ problems: CompanyProblem[] }>(
        `/api/companies/${encodeURIComponent(company)}/problems?limit=80`,
      );
      if (mine !== generation.current) return;
      setProblems(r.problems);
      setActive(company);
    } catch (e) {
      if (mine !== generation.current) return;
      setProblemsError(String(e));
    } finally {
      if (mine === generation.current) setLoadingProblems(false);
    }
  }, []);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  if (companiesError) return <div className="notice bad">{companiesError}</div>;

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
                disabled={loadingProblems}
                onClick={() => void loadProblems(c.company)}
              >
                <span>{c.company}</span>
                <span className="n">{c.n}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="company-problems">
          {problemsError ? (
            <div className="notice bad" style={{ marginBottom: 12 }}>{problemsError}</div>
          ) : null}
          {active ? (
            <>
              <h2>{active}</h2>
              {problems.map((p) => (
                <Row key={p.qid} className={p.solved ? "solved" : ""} onClick={() => onOpen(p.slug)}>
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
                </Row>
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
