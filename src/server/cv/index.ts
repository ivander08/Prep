/**
 * CV document storage.
 *
 * The document is the source of truth and lives in `cv_documents.doc_json`. Everything else — the
 * `.tex`, the PDF, the ATS checks — is derived on demand, so a template fix applies to every saved
 * CV the next time it is rendered instead of leaving stale artifacts beside it.
 *
 * The compiled PDF is cached in `meta` under `prep:cv:<id>:pdf`. That is the same `meta`-as-cache
 * pattern `models.ts` uses for the model catalog, and it exists for one concrete reason: an
 * `<iframe src>` can issue more than one GET per load, and each compile is a 2-4 second subprocess
 * pair. The cache is invalidated on every `PUT` and `DELETE`.
 */

import { db, getMeta, setMeta } from "../db.ts";
import { emptyDoc, validateDoc, type CvDoc } from "./doc.ts";

export type CvSummary = { id: number; name: string; updatedAt: string };

type CvRow = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  doc_json: string;
  jd: string;
  model: string | null;
  cost_idr: number | null;
};

/** Every saved CV, most recently updated first. */
export function listCvs(): CvSummary[] {
  return db
    .query<{ id: number; name: string; updated_at: string }, []>(
      "SELECT id, name, updated_at FROM cv_documents ORDER BY updated_at DESC",
    )
    .all()
    .map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at }));
}

/** One document with its job description. Null when the id is unknown. */
export function getCv(id: number): { doc: CvDoc; jd: string } | null {
  const row = db.query<CvRow, [number]>("SELECT * FROM cv_documents WHERE id = ?").get(id);
  if (!row) return null;

  const parsed = validateDoc(JSON.parse(row.doc_json));
  // A stored document that no longer validates (an older shape, a hand-edited row) falls back to an
  // empty document named after the row rather than throwing: the user should be able to open it and
  // fix it, not be locked out of their own file.
  return { doc: parsed.ok ? parsed.value : emptyDoc(row.name), jd: row.jd };
}

/** Create a document and return its id. */
export function createCv(name: string): number {
  const doc = emptyDoc(name);
  const now = new Date().toISOString();
  db.run(
    "INSERT INTO cv_documents (name, created_at, updated_at, doc_json) VALUES (?, ?, ?, ?)",
    [doc.name, now, now, JSON.stringify(doc)],
  );
  return db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
}

/**
 * Replace a document.
 *
 * The cached PDF is dropped in the same transaction: a stale PDF served after an edit is worse than
 * no PDF, because it looks like the edit did nothing.
 */
export function updateCv(id: number, doc: CvDoc): void {
  const exists = db.query<{ id: number }, [number]>("SELECT id FROM cv_documents WHERE id = ?").get(id);
  if (!exists) throw new Error(`unknown CV: ${id}`);

  db.transaction(() => {
    db.run("UPDATE cv_documents SET doc_json = ?, name = ?, updated_at = ? WHERE id = ?", [
      JSON.stringify(doc),
      doc.name,
      new Date().toISOString(),
      id,
    ]);
    db.run("DELETE FROM meta WHERE key = ?", [pdfKey(id)]);
  })();
}

/** Store the pasted job description so coverage can be recomputed without pasting it again. */
export function setCvJd(id: number, jd: string): void {
  const exists = db.query<{ id: number }, [number]>("SELECT id FROM cv_documents WHERE id = ?").get(id);
  if (!exists) throw new Error(`unknown CV: ${id}`);
  db.run("UPDATE cv_documents SET jd = ?, updated_at = ? WHERE id = ?", [jd, new Date().toISOString(), id]);
}

export function deleteCv(id: number): void {
  db.transaction(() => {
    db.run("DELETE FROM cv_documents WHERE id = ?", [id]);
    db.run("DELETE FROM meta WHERE key = ?", [pdfKey(id)]);
  })();
}

// ---------------------------------------------------------------------------
// The compiled-PDF cache
// ---------------------------------------------------------------------------

export function pdfKey(id: number): string {
  return `prep:cv:${id}:pdf`;
}

/** Cache the compiled bytes. Stored as a JSON array in `meta`, which is TEXT. */
export function cachePdf(id: number, pdf: Uint8Array): void {
  setMeta(pdfKey(id), JSON.stringify(Array.from(pdf)));
}

/** The cached PDF, or null when nothing has been rendered since the last edit. */
export function cachedPdf(id: number): Uint8Array | null {
  const raw = getMeta(pdfKey(id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return Uint8Array.from(parsed as number[]);
  } catch {
    return null;
  }
}
