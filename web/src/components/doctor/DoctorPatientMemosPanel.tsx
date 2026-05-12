"use client";

import { useState } from "react";

type PatientMemo = {
  id: string;
  title: string;
  body: string;
  status: string;
  tags: string | null;
  updatedAt: string;
};

type Props = {
  patientId: string;
  initialMemos: PatientMemo[];
};

type Editor = {
  title: string;
  body: string;
  status: string;
  tags: string;
};

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || "Unexpected response" };
  }
}

function formatDate(value?: string | null) {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export default function DoctorPatientMemosPanel({ patientId, initialMemos }: Props) {
  const [memos, setMemos] = useState(initialMemos);
  const [editor, setEditor] = useState<Editor>({ title: "", body: "", status: "open", tags: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/doctor/patient/${patientId}/memos`, { cache: "no-store" });
    const data = await safeJson(res);
    if (res.ok) setMemos(data.memos || []);
  }

  async function saveMemo() {
    const title = editor.title.trim();
    const body = editor.body.trim();
    if (!title || !body) {
      setError("Title and body are required.");
      return;
    }

    setLoading(true);
    setError(null);
    const res = await fetch(editingId ? `/api/doctor/patient/${patientId}/memos/${editingId}` : `/api/doctor/patient/${patientId}/memos`, {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        body,
        status: editor.status,
        tags: editor.tags.trim() || null,
      }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Unable to save memo");
      setLoading(false);
      return;
    }

    await refresh();
    setEditor({ title: "", body: "", status: "open", tags: "" });
    setEditingId(null);
    setLoading(false);
  }

  async function deleteMemo(id: string) {
    setLoading(true);
    const res = await fetch(`/api/doctor/patient/${patientId}/memos/${id}`, { method: "DELETE" });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Unable to delete memo");
    } else {
      await refresh();
      if (editingId === id) {
        setEditor({ title: "", body: "", status: "open", tags: "" });
        setEditingId(null);
      }
    }
    setLoading(false);
  }

  return (
    <section className="card-contrast stack-lg">
      <div className="panel-header">
        <div>
          <p className="section-title">Patient Memos</p>
          <p className="subtle text-sm mt-2">Keep informal reminders, treatment notes, and next-visit prompts separate from formal clinical reviews.</p>
        </div>
        <span className="pill">Informal notes</span>
      </div>

      {error ? (
        <div className="status-banner status-banner--error">
          <strong>Issue</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="surface stack-md form-shell">
        <input placeholder="Memo title" value={editor.title} onChange={(event) => setEditor((prev) => ({ ...prev, title: event.target.value }))} />
        <div className="input-shell input-shell--compact">
          <select value={editor.status} onChange={(event) => setEditor((prev) => ({ ...prev, status: event.target.value }))}>
            <option value="open">Open</option>
            <option value="follow-up">Follow-up</option>
            <option value="done">Done</option>
          </select>
          <input placeholder="Tags (labs, follow-up, call back)" value={editor.tags} onChange={(event) => setEditor((prev) => ({ ...prev, tags: event.target.value }))} />
        </div>
        <textarea rows={5} placeholder="Write an informal chart memo for this patient" value={editor.body} onChange={(event) => setEditor((prev) => ({ ...prev, body: event.target.value }))} />
        <div className="input-shell compact-actions compact-actions--wrap">
          <button className="btn-primary btn-fit" type="button" disabled={loading} onClick={saveMemo}>
            {loading ? "Saving..." : editingId ? "Update memo" : "Save memo"}
          </button>
          {editingId ? (
            <button className="btn-secondary btn-fit" type="button" onClick={() => { setEditingId(null); setEditor({ title: "", body: "", status: "open", tags: "" }); }}>
              Cancel edit
            </button>
          ) : null}
        </div>
      </div>

      {memos.length === 0 ? (
        <div className="empty-state">
          <p className="section-title">No memos yet</p>
          <p className="subtle text-sm">Add a quick treatment note or reminder after reviewing the chart.</p>
        </div>
      ) : (
        <div className="stack-md">
          {memos.map((memo) => (
            <article key={memo.id} className="card card--dense stack-sm">
              <div className="panel-header">
                <div>
                  <p className="font-semibold">{memo.title}</p>
                  <p className="subtle text-xs mt-1">{memo.status} · Updated {formatDate(memo.updatedAt)}</p>
                </div>
                <div className="input-shell compact-actions compact-actions--wrap">
                  <button className="btn-secondary btn-fit" type="button" onClick={() => { setEditingId(memo.id); setEditor({ title: memo.title, body: memo.body, status: memo.status, tags: memo.tags || "" }); }}>
                    Edit
                  </button>
                  <button className="btn-secondary btn-fit" type="button" disabled={loading} onClick={() => deleteMemo(memo.id)}>
                    Delete
                  </button>
                </div>
              </div>
              <p className="subtle text-sm leading-7">{memo.body}</p>
              {memo.tags ? <p className="muted text-xs">Tags: {memo.tags}</p> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
