import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  GRADE_LABEL,
  type GenerationProgress,
  type ProjectDetail,
  type ProjectSummary,
} from "../api";
import { Dialog } from "./Dialog";
import { ProjectModuleView } from "./ProjectModuleView";
import { Row } from "./Row";

/**
 * The Projects track: import a codebase you built, study it module by module.
 *
 * Laid out like every other track (list on the left, work on the right, `.workspace`/`.pane`), with
 * one difference that shapes the whole component: generation is a long background job, so the right
 * pane has four states — running (polled), ready (the module list), error (the message and a retry),
 * and empty (the import form). Polling is the first such loop in the app, so its cleanup is
 * explicit: the interval is cleared on unmount and whenever the project stops running.
 */
export function ProjectsView({
  /** The project slug a due row asked for. Its `ref` is `<projectSlug>/<moduleSlug>`. */
  initialTarget,
}: {
  initialTarget?: string | null;
}): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [openModule, setOpenModule] = useState<string | null>(null);
  const [root, setRoot] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectSummary | null>(null);

  /**
   * The slug the pending target already opened. A ref, not state: it stops the bridge firing twice
   * for the same slug, and re-rendering to record that would be a render for bookkeeping.
   */
  const bridged = useRef<string | null>(null);

  const loadList = useCallback(async (): Promise<ProjectSummary[]> => {
    try {
      const r = await api<{ projects: ProjectSummary[] }>("/api/projects");
      setProjects(r.projects);
      return r.projects;
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  const loadDetail = useCallback(async (id: number): Promise<ProjectDetail | null> => {
    try {
      const r = await api<{ project: ProjectDetail }>(`/api/projects/${id}`);
      setDetail(r.project);
      return r.project;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  // On mount: the list, then the project a due row asked for. Sequenced in one effect so the two
  // cannot race and land on a project that is not in the list yet.
  useEffect(() => {
    void (async () => {
      const list = await loadList();
      if (initialTarget && bridged.current !== initialTarget) {
        const hit = list.find((p) => p.slug === initialTarget);
        if (hit) {
          bridged.current = initialTarget;
          setSelectedId(hit.id);
        }
      }
    })();
  }, [initialTarget, loadList]);

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  /**
   * Poll while a generation is running.
   *
   * The interval is keyed on the run state, so it stops the moment the status leaves `running` and
   * is cleared on unmount. Without the cleanup, navigating away left a timer refreshing a detail
   * for a project no longer on screen.
   */
  useEffect(() => {
    if (!detail || detail.project.status !== "running" || selectedId === null) return;
    const id = selectedId;
    const timer = setInterval(() => {
      void (async () => {
        const fresh = await loadDetail(id);
        if (fresh && fresh.project.status !== "running") void loadList();
      })();
    }, 2000);
    return () => clearInterval(timer);
  }, [detail, selectedId, loadDetail, loadList]);

  const add = useCallback(async () => {
    const path = root.trim();
    if (path.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ projectId: number }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ root: path, name: name.trim() || undefined }),
      });
      setRoot("");
      setName("");
      setSelectedId(r.projectId);
      await loadList();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [root, name, loadList]);

  const refresh = useCallback(async () => {
    if (selectedId === null) return;
    setError(null);
    try {
      await api(`/api/projects/${selectedId}/refresh`, { method: "POST" });
      await loadDetail(selectedId);
    } catch (e) {
      setError(String(e));
    }
  }, [selectedId, loadDetail]);

  const remove = useCallback(
    async (id: number) => {
      setConfirmDelete(null);
      try {
        await api(`/api/projects/${id}`, { method: "DELETE" });
        if (selectedId === id) setSelectedId(null);
        await loadList();
      } catch (e) {
        setError(String(e));
      }
    },
    [selectedId, loadList],
  );

  // A module takes over the whole view, the way `ProblemView` does in the shell.
  if (detail && openModule) {
    const module = detail.modules.find((m) => m.slug === openModule);
    if (module) {
      return (
        <ProjectModuleView
          project={detail.project}
          module={module}
          onBack={() => setOpenModule(null)}
          onGraded={() => void loadDetail(detail.project.id)}
        />
      );
    }
  }

  return (
    <>
      <h1>Projects</h1>
      <p className="muted">
        Point Prep at a project you built. It reads the source and writes a curriculum that teaches
        the codebase back to you: ordered modules, each with a study document citing{" "}
        <span className="mono">path:line</span> and 4–6 interview questions. Grading an answer
        schedules the module for review.
      </p>

      {error ? (
        <div className="notice bad" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <div className="workspace">
        <div className="fundamentals-list bounded">
          <div className="module-head">
            <span>Imported</span>
            <span className="mono muted small">{projects.length}</span>
          </div>
          <div className="table" style={{ border: "none" }}>
            {projects.map((p) => (
              <Row
                key={p.id}
                className={p.id === selectedId ? "active" : ""}
                onClick={() => {
                  setSelectedId(p.id);
                  setOpenModule(null);
                }}
              >
                <span className="qid">{p.learned > 0 ? "✓" : "·"}</span>
                <span className="title">
                  {p.name}
                  <span className="muted small sub">{p.root}</span>
                  <span className="muted small sub">
                    {p.learned}/{p.modules} modules learned
                  </span>
                </span>
                <span className={`badge ${p.status === "ready" ? "Easy" : p.status === "error" ? "Hard" : "Medium"}`}>
                  {p.status}
                </span>
              </Row>
            ))}
          </div>

          {/* Outside the `.table`, which has no padding of its own; `.empty` carries the app's
              standard empty-state padding and rule. */}
          {projects.length === 0 ? <div className="empty">No projects imported yet.</div> : null}

          <div className="module-head" style={{ marginTop: 12 }}>
            <span>Add project</span>
          </div>
          <div className="pane" style={{ padding: "10px 12px" }}>
            <div className="field">
              <span>Directory</span>
              <input
                value={root}
                placeholder="C:\\path\\to\\your\\project"
                onChange={(e) => setRoot(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void add();
                }}
              />
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <span>Name (optional)</span>
              <input value={name} placeholder="defaults to the folder name" onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="primary" onClick={() => void add()} disabled={busy || root.trim().length === 0}>
                {busy ? "Starting…" : "Import"}
              </button>
              <span className="muted small">Generation runs in the background and costs model calls.</span>
            </div>
          </div>
        </div>

        <div className="pane">
          {!detail ? (
            <div className="empty">
              Pick a project, or import one. The curriculum is generated from the project's actual
              source, so it teaches the code that exists — not a generic outline of the stack.
            </div>
          ) : (
            <>
              <div className="spread">
                <h2 style={{ marginTop: 0 }}>{detail.project.name}</h2>
                <div className="row">
                  <button onClick={() => void refresh()} disabled={detail.project.status === "running"}>
                    {detail.project.generatedAt ? "Regenerate" : "Retry"}
                  </button>
                  <button className="danger" onClick={() => setConfirmDelete(detail.project)}>
                    Delete
                  </button>
                </div>
              </div>
              <p className="muted mono small">{detail.project.root}</p>

              {detail.stack.length > 0 ? (
                <div className="row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
                  {detail.stack.map((s) => (
                    <span key={s} className="badge Mid">
                      {s}
                    </span>
                  ))}
                </div>
              ) : null}

              {detail.scan ? (
                <p className="muted small">
                  {detail.scan.fileCount} files · {Math.round(detail.scan.totalBytes / 1024)} KB read
                  {detail.scan.truncated ? " (truncated)" : ""}
                  {detail.scan.fileCount > 0 ? (
                    <>
                      {" · "}
                      {Object.entries(detail.scan.byLang)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 6)
                        .map(([lang, n]) => `${lang} ${n}`)
                        .join(", ")}
                    </>
                  ) : null}
                </p>
              ) : null}

              {detail.project.status === "running" && detail.job ? <GenerationCard job={detail.job} /> : null}

              {detail.project.status === "error" ? (
                <div className="notice bad">
                  <strong>Generation failed.</strong> {detail.project.error}
                </div>
              ) : null}

              {/* A run that skipped some modules is still `ready` — the project is usable — so the
                  skipped ones are surfaced as a warning rather than dressed up as a failure. */}
              {detail.project.status === "ready" && detail.project.error ? (
                <div className="notice warn">
                  <strong>Partially generated.</strong> {detail.project.error}
                </div>
              ) : null}

              {detail.project.status === "ready" ? (
                <>
                  <h3>Modules</h3>
                  <div className="table">
                    {detail.modules.map((m) => (
                      <Row
                        key={m.slug}
                        className={m.learned ? "solved" : ""}
                        onClick={() => setOpenModule(m.slug)}
                        title={m.objective}
                      >
                        <span className="qid">{m.learned ? "✓" : "·"}</span>
                        <span className="title">
                          {m.position}. {m.title}
                          <span className="muted small sub">{m.objective}</span>
                        </span>
                        <span className="mono muted small">
                          {m.files.length} files
                          {m.lastGrade ? ` · ${GRADE_LABEL[m.lastGrade] ?? m.lastGrade}` : ""}
                        </span>
                      </Row>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>

      {confirmDelete ? (
        <Dialog
          title={`Delete ${confirmDelete.name}?`}
          confirmLabel="Delete"
          danger
          onConfirm={() => void remove(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        >
          <p>
            This removes the project, its modules, its graded answers and its review cards. The files
            on disk are not touched.
          </p>
        </Dialog>
      ) : null}
    </>
  );
}

/** The generation progress, read straight off the job row the server is updating. */
function GenerationCard({ job }: { job: GenerationProgress & { status: string } }): React.JSX.Element {
  const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
  const label =
    job.phase === "scan"
      ? "Reading the directory"
      : job.phase === "map"
        ? "Planning the modules"
        : job.phase === "modules"
          ? "Writing the modules"
          : job.phase === "questions"
            ? "Writing the interview questions"
            : "Finishing";

  return (
    <div className="notice info">
      <div className="spread">
        <span>
          <strong>{label}</strong>
          {job.note ? <span className="muted"> · {job.note}</span> : null}
        </span>
        <span className="mono small">
          {job.done}/{job.total}
        </span>
      </div>
      <div className="cv-bar" style={{ marginTop: 8 }}>
        <div className="cv-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Generation runs in the background. This page polls every two seconds.
      </p>
    </div>
  );
}
