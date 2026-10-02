import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type CvCheck,
  type CvCoverage,
  type CvDoc,
  type CvEntry,
  type CvRenderResponse,
  type CvSummary,
  type CvTexStatus,
} from "../api";
import { Dialog } from "./Dialog";

/** The four section titles a new document starts with, and what the "add section" picker offers. */
const CANONICAL = ["Education", "Experience", "Projects", "Skills"] as const;

/**
 * The CV maker: author a document, render it to a real PDF, and see what an ATS extracts.
 *
 * Three panes inside the standard `.workspace` grid: documents, the editor, and the preview with the
 * deterministic checks. The editor autosaves on blur, the same pattern `ProseTrackView` uses, so
 * there is no Save button to forget.
 *
 * Two deliberate omissions:
 *   - No keyword auto-insertion. The coverage table SHOWS which of the posting's terms are missing
 *     and stops there; padding a CV with terms the user cannot defend is the failure mode this
 *     feature exists to prevent.
 *   - No print stylesheet. The preview is the browser's own PDF viewer in an iframe, so the app's
 *     dark theme never touches the document.
 */
export function CvView(): React.JSX.Element {
  const [docs, setDocs] = useState<CvSummary[]>([]);
  const [id, setId] = useState<number | null>(null);
  const [doc, setDoc] = useState<CvDoc | null>(null);
  const [jd, setJd] = useState("");
  const [coverage, setCoverage] = useState<CvCoverage | null>(null);
  const [tex, setTex] = useState<CvTexStatus | null>(null);
  const [render, setRender] = useState<CvRenderResponse | null>(null);
  const [stamp, setStamp] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CvSummary | null>(null);

  /** The doc as last saved, so a blur that changed nothing does not issue a PUT. */
  const saved = useRef<string>("");

  const loadDocs = useCallback(async (): Promise<CvSummary[]> => {
    try {
      const r = await api<{ documents: CvSummary[] }>("/api/cv");
      setDocs(r.documents);
      return r.documents;
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const r = await api<CvTexStatus>("/api/cv/tex");
        setTex(r);
      } catch {
        setTex({ available: false, engine: null, tools: false });
      }
      const list = await loadDocs();
      if (list.length > 0) setId(list[0]!.id);
    })();
  }, [loadDocs]);

  useEffect(() => {
    if (id === null) {
      setDoc(null);
      return;
    }
    void (async () => {
      try {
        const r = await api<{ doc: CvDoc; jd: string }>(`/api/cv/${id}`);
        setDoc(r.doc);
        setJd(r.jd);
        setCoverage(null);
        setRender(null);
        saved.current = JSON.stringify(r.doc);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [id]);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: number; doc: CvDoc }>("/api/cv", {
        method: "POST",
        body: JSON.stringify({ name: "Untitled CV" }),
      });
      await loadDocs();
      setId(r.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [loadDocs]);

  const save = useCallback(
    async (next: CvDoc) => {
      if (id === null) return;
      const serialized = JSON.stringify(next);
      if (serialized === saved.current) return;
      try {
        await api(`/api/cv/${id}`, { method: "PUT", body: JSON.stringify({ doc: next }) });
        saved.current = serialized;
        // The cached PDF is dropped server-side on a PUT, so a render made before this edit is stale.
        setRender(null);
        void loadDocs();
      } catch (e) {
        setError(String(e));
      }
    },
    [id, loadDocs],
  );

  /** Every field edit goes through here: update local state, then persist. */
  const edit = useCallback(
    (mutate: (draft: CvDoc) => void) => {
      if (!doc) return;
      const next: CvDoc = structuredClone(doc);
      mutate(next);
      setDoc(next);
      void save(next);
    },
    [doc, save],
  );

  const remove = useCallback(
    async (docId: number) => {
      setConfirmDelete(null);
      try {
        await api(`/api/cv/${docId}`, { method: "DELETE" });
        if (id === docId) setId(null);
        await loadDocs();
      } catch (e) {
        setError(String(e));
      }
    },
    [id, loadDocs],
  );

  const checkJd = useCallback(async () => {
    if (id === null) return;
    try {
      const r = await api<{ coverage: CvCoverage }>(`/api/cv/${id}/jd`, {
        method: "POST",
        body: JSON.stringify({ jd }),
      });
      setCoverage(r.coverage);
    } catch (e) {
      setError(String(e));
    }
  }, [id, jd]);

  const doRender = useCallback(async () => {
    if (id === null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<CvRenderResponse>(`/api/cv/${id}/render`, { method: "POST" });
      setRender(r);
      setStamp(Date.now());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [id]);

  /** Export the document as JSON. Pure client-side: no route, no round trip. */
  const exportJson = useCallback(() => {
    if (!doc) return;
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "cv"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [doc]);

  const importJson = useCallback(
    (file: File) => {
      void (async () => {
        try {
          const text = await file.text();
          const parsed = JSON.parse(text) as CvDoc;
          setDoc(parsed);
          // Validated by the same server rules on the PUT, so a malformed import is rejected with
          // field names rather than stored.
          await save(parsed);
        } catch (e) {
          setError(`Could not read that file: ${String(e)}`);
        }
      })();
    },
    [save],
  );

  return (
    <>
      <h1>CV</h1>
      <p className="muted">
        Author a CV, render it through this machine's LaTeX, and see what an ATS actually extracts
        from the result. The checks are deterministic — they run <span className="mono">pdftotext</span>,{" "}
        <span className="mono">pdffonts</span> and <span className="mono">pdfinfo</span> on the real
        PDF, not on an intention.
      </p>

      {error ? (
        <div className="notice bad" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <div className="cv-layout">
        {/* 1. Documents */}
        <div>
          <div className="spread">
            <h2 style={{ marginTop: 0 }}>Documents</h2>
            <button onClick={() => void create()} disabled={busy}>
              New CV
            </button>
          </div>
          {/* The table is rendered only when it has rows: with none it is a 2px bordered sliver
              above the empty state. */}
          {docs.length > 0 ? (
            <div className="table">
              {docs.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`problem-row ${d.id === id ? "active" : ""}`}
                  onClick={() => setId(d.id)}
                >
                  {/* The marker column `.problem-row` expects. Without it the title lands in the
                      52px first column and wraps onto two lines. */}
                  <span className="qid">{d.id === id ? "▸" : "·"}</span>
                  <span className="title">
                    {d.name}
                    <span className="muted small sub">{new Date(d.updatedAt).toLocaleDateString()}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {/* Outside `.table`, which has a border and no padding: inside it, the text sat flush
              against the top-left corner. `.empty` is the app's "nothing here" state and carries
              its own padding and rule. */}
          {docs.length === 0 ? <div className="empty">No CVs yet. Create one to start.</div> : null}

          {doc ? (
            <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
              <button onClick={exportJson}>Export JSON</button>
              <label className="cv-field" style={{ margin: 0 }}>
                <span>Import</span>
                <input
                  type="file"
                  accept="application/json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importJson(f);
                  }}
                />
              </label>
              <button className="danger" onClick={() => setConfirmDelete(docs.find((d) => d.id === id) ?? null)}>
                Delete
              </button>
            </div>
          ) : null}
        </div>

        {/* 2. Editor */}
        <div>
          {!doc ? (
            <div className="empty">Create a CV or pick one to edit.</div>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>Editor</h2>

              <div className="cv-grid-2">
                <Field label="Name" value={doc.name} onChange={(v) => edit((d) => void (d.name = v))} />
                <Field label="Headline" value={doc.headline ?? ""} onChange={(v) => edit((d) => void (d.headline = v))} />
                <Field label="Email" value={doc.email} onChange={(v) => edit((d) => void (d.email = v))} />
                <Field label="Phone" value={doc.phone ?? ""} onChange={(v) => edit((d) => void (d.phone = v))} />
                <Field label="Location" value={doc.location ?? ""} onChange={(v) => edit((d) => void (d.location = v))} />
              </div>

              <div className="cv-field" style={{ marginTop: 8 }}>
                <span>Summary</span>
                <textarea value={doc.summary ?? ""} onChange={(e) => edit((d) => void (d.summary = e.target.value))} />
              </div>

              <div className="cv-field" style={{ marginTop: 8 }}>
                <span>Links (one per line, `label | url`)</span>
                <textarea
                  value={doc.links.map((l) => `${l.label} | ${l.url}`).join("\n")}
                  placeholder="GitHub | https://github.com/you"
                  onChange={(e) =>
                    edit((d) => {
                      d.links = e.target.value
                        .split("\n")
                        .map((line) => {
                          const [label, ...rest] = line.split("|");
                          return { label: (label ?? "").trim(), url: rest.join("|").trim() };
                        })
                        .filter((l) => l.label.length > 0 || l.url.length > 0);
                    })
                  }
                />
              </div>

              {doc.sections.map((section, si) => (
                <div key={si} style={{ marginTop: 16 }}>
                  <div className="cv-entry-head">
                    <strong>{section.title}</strong>
                    <div className="row">
                      <button
                        onClick={() =>
                          edit((d) => {
                            d.sections[si]!.entries.push({ org: "", role: "", start: "", end: "", bullets: [""] });
                          })
                        }
                      >
                        + entry
                      </button>
                      <button
                        className="danger"
                        onClick={() =>
                          edit((d) => {
                            d.sections.splice(si, 1);
                          })
                        }
                      >
                        remove section
                      </button>
                    </div>
                  </div>

                  {section.entries.map((entry, ei) => (
                    <EntryEditor
                      key={ei}
                      entry={entry}
                      onChange={(mutate) =>
                        edit((d) => {
                          mutate(d.sections[si]!.entries[ei]!);
                        })
                      }
                      onRemove={() =>
                        edit((d) => {
                          d.sections[si]!.entries.splice(ei, 1);
                        })
                      }
                    />
                  ))}
                </div>
              ))}

              <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
                <span className="muted small">Add section:</span>
                {CANONICAL.filter((t) => !doc.sections.some((s) => s.title === t)).map((t) => (
                  <button key={t} onClick={() => edit((d) => void d.sections.push({ title: t, entries: [{ org: "", role: "", start: "", end: "", bullets: [""] }] }))}>
                    {t}
                  </button>
                ))}
                <FreeSection onAdd={(title) => edit((d) => void d.sections.push({ title, entries: [{ org: "", role: "", start: "", end: "", bullets: [""] }] }))} />
              </div>

              <h3 style={{ marginTop: 18 }}>Skills</h3>
              {doc.skills.map((group, gi) => (
                <div key={gi} className="cv-grid-2" style={{ marginBottom: 6 }}>
                  <Field label="Label" value={group.label} onChange={(v) => edit((d) => void (d.skills[gi]!.label = v))} />
                  <Field
                    label="Items (comma separated)"
                    value={group.items.join(", ")}
                    onChange={(v) =>
                      edit((d) => {
                        d.skills[gi]!.items = v.split(",").map((s) => s.trim()).filter(Boolean);
                      })
                    }
                  />
                </div>
              ))}
              <button onClick={() => edit((d) => void d.skills.push({ label: "", items: [] }))}>+ skill group</button>
            </>
          )}
        </div>

        {/* 3. Preview + checks */}
        <div>
          <h2 style={{ marginTop: 0 }}>Preview</h2>

          {tex && !tex.available ? (
            <div className="notice warn">
              No LaTeX engine found. Install MiKTeX (Windows) or TeX Live (Linux/macOS) so{" "}
              <span className="mono">pdflatex</span> is on PATH, then reload.
            </div>
          ) : (
            <>
              <div className="row">
                <button className="primary" onClick={() => void doRender()} disabled={busy || !doc}>
                  {busy ? "Rendering…" : "Render PDF"}
                </button>
                {render && id !== null ? (
                  <a href={`/api/cv/${id}/pdf?download=1&t=${stamp}`} download>
                    Download PDF
                  </a>
                ) : null}
              </div>
              <p className="muted small">
                Engine: <span className="mono">{tex?.engine ?? "…"}</span>
                {tex && !tex.tools ? " · ATS checks unavailable (poppler tools not found)" : ""}
              </p>
            </>
          )}

          {render ? (
            <>
              <h3>ATS checks</h3>
              <div className="table">
                {render.checks.map((c) => (
                  <CheckRow key={c.id} check={c} />
                ))}
              </div>

              {id !== null ? (
                <div className="cv-preview" style={{ marginTop: 12 }}>
                  <iframe title="CV preview" src={`/api/cv/${id}/pdf?t=${stamp}`} />
                </div>
              ) : null}

              <details className="hint" style={{ marginTop: 12 }}>
                <summary>LaTeX source</summary>
                <pre className="exemplar">
                  <code>{render.tex}</code>
                </pre>
              </details>
            </>
          ) : null}

          <h3 style={{ marginTop: 18 }}>Job description</h3>
          <textarea
            className="design-textarea"
            value={jd}
            placeholder="Paste the posting. The table below shows which of its terms your CV already covers — and which it does not. Nothing is inserted for you."
            onChange={(e) => setJd(e.target.value)}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => void checkJd()} disabled={!doc || jd.trim().length === 0}>
              Check keywords
            </button>
            {coverage ? (
              <span className="muted small">
                {coverage.covered}/{coverage.total} covered
              </span>
            ) : null}
          </div>

          {coverage ? (
            <div style={{ marginTop: 10 }}>
              {coverage.rows.map((r) => (
                <span key={r.term} className={`cv-kw ${r.present ? "hit" : "miss"}`} title={r.present ? (r.inSkills ? "in Skills" : r.inSummary ? "in Summary" : "in the document") : "not present"}>
                  {r.term}
                  {!r.present ? <span className="hint"> · add to a bullet or Skills</span> : null}
                </span>
              ))}
            </div>
          ) : null}
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
          <p>This removes the document and its compiled PDF. Nothing else is touched.</p>
        </Dialog>
      ) : null}
    </>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): React.JSX.Element {
  return (
    <label className="cv-field">
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function EntryEditor({
  entry,
  onChange,
  onRemove,
}: {
  entry: CvEntry;
  onChange: (mutate: (e: CvEntry) => void) => void;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <div className="cv-entry">
      <div className="cv-entry-head">
        <span className="muted small">
          {entry.role || entry.org || "(new entry)"}
        </span>
        <button className="danger" onClick={onRemove}>
          remove
        </button>
      </div>
      <div className="cv-grid-2">
        <Field label="Role" value={entry.role} onChange={(v) => onChange((e) => void (e.role = v))} />
        <Field label="Organisation" value={entry.org} onChange={(v) => onChange((e) => void (e.org = v))} />
        <Field label="Start" value={entry.start} onChange={(v) => onChange((e) => void (e.start = v))} />
        <Field label="End" value={entry.end} onChange={(v) => onChange((e) => void (e.end = v))} />
      </div>
      <div className="cv-field" style={{ marginTop: 6 }}>
        <span>Bullets (one per line)</span>
        <textarea
          value={entry.bullets.join("\n")}
          placeholder="Cut financial reporting latency 40% by profiling efficient workflow paths."
          onChange={(e) =>
            onChange((x) => {
              x.bullets = e.target.value.split("\n");
            })
          }
        />
      </div>
    </div>
  );
}

/** A free-text section title, for a heading outside the canonical four. */
function FreeSection({ onAdd }: { onAdd: (title: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  if (!open) return <button onClick={() => setOpen(true)}>Custom…</button>;

  return (
    <span className="row">
      <input
        value={title}
        autoFocus
        placeholder="Section title"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim().length > 0) {
            onAdd(title.trim());
            setOpen(false);
            setTitle("");
          }
        }}
      />
      <button
        onClick={() => {
          if (title.trim().length > 0) onAdd(title.trim());
          setOpen(false);
          setTitle("");
        }}
      >
        Add
      </button>
    </span>
  );
}

function CheckRow({ check }: { check: CvCheck }): React.JSX.Element {
  return (
    <div className={`cv-check ${check.ok ? "pass" : "fail"}`}>
      <span className="mark">{check.ok ? "✓" : "✕"}</span>
      <span>
        {check.label}
        {!check.ok && check.detail ? <span className="detail"> — {check.detail}</span> : null}
      </span>
    </div>
  );
}
