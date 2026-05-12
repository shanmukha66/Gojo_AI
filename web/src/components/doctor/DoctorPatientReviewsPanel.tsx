"use client";

import { useState } from "react";

type PatientReview = {
  id: string;
  appointmentId: string | null;
  visitId: string | null;
  title: string;
  summary: string;
  assessment: string | null;
  plan: string | null;
  followUp: string | null;
  revisitRecommended: boolean;
  status: string;
  tags: string | null;
  updatedAt: string;
};

type Props = {
  patientId: string;
  initialReviews: PatientReview[];
  appointmentOptions: Array<{ id: string; label: string }>;
  visitOptions: Array<{ id: string; label: string }>;
};

type Editor = {
  title: string;
  summary: string;
  assessment: string;
  plan: string;
  followUp: string;
  revisitRecommended: boolean;
  status: string;
  tags: string;
  appointmentId: string;
  visitId: string;
};

const emptyEditor: Editor = {
  title: "",
  summary: "",
  assessment: "",
  plan: "",
  followUp: "",
  revisitRecommended: false,
  status: "draft",
  tags: "",
  appointmentId: "",
  visitId: "",
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

export default function DoctorPatientReviewsPanel({ patientId, initialReviews, appointmentOptions, visitOptions }: Props) {
  const [reviews, setReviews] = useState(initialReviews);
  const [editor, setEditor] = useState<Editor>(emptyEditor);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/doctor/patient/${patientId}/reviews`, { cache: "no-store" });
    const data = await safeJson(res);
    if (res.ok) setReviews(data.reviews || []);
  }

  async function saveReview() {
    const title = editor.title.trim();
    const summary = editor.summary.trim();
    if (!title || !summary) {
      setError("Review title and summary are required.");
      return;
    }

    setLoading(true);
    setError(null);
    const res = await fetch(editingId ? `/api/doctor/patient/${patientId}/reviews/${editingId}` : `/api/doctor/patient/${patientId}/reviews`, {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        summary,
        assessment: editor.assessment.trim() || null,
        plan: editor.plan.trim() || null,
        followUp: editor.followUp.trim() || null,
        revisitRecommended: editor.revisitRecommended,
        status: editor.status,
        tags: editor.tags.trim() || null,
        appointmentId: editor.appointmentId || null,
        visitId: editor.visitId || null,
      }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Unable to save patient review");
      setLoading(false);
      return;
    }

    await refresh();
    setEditingId(null);
    setEditor(emptyEditor);
    setLoading(false);
  }

  async function deleteReview(id: string) {
    setLoading(true);
    const res = await fetch(`/api/doctor/patient/${patientId}/reviews/${id}`, { method: "DELETE" });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Unable to delete patient review");
    } else {
      await refresh();
      if (editingId === id) {
        setEditingId(null);
        setEditor(emptyEditor);
      }
    }
    setLoading(false);
  }

  return (
    <section className="card-contrast stack-lg">
      <div className="panel-header">
        <div>
          <p className="section-title">Formal Patient Reviews</p>
          <p className="subtle text-sm mt-2">Use reviews for consultation-grade assessment, plan, and follow-up, not quick memo capture.</p>
        </div>
        <span className="pill">Formal review</span>
      </div>

      {error ? (
        <div className="status-banner status-banner--error">
          <strong>Issue</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="surface stack-md form-shell form-shell--wide">
        <input placeholder="Review title" value={editor.title} onChange={(event) => setEditor((prev) => ({ ...prev, title: event.target.value }))} />
        <textarea rows={3} placeholder="Visit summary" value={editor.summary} onChange={(event) => setEditor((prev) => ({ ...prev, summary: event.target.value }))} />
        <div className="input-shell input-shell--compact">
          <select value={editor.status} onChange={(event) => setEditor((prev) => ({ ...prev, status: event.target.value }))}>
            <option value="draft">Draft</option>
            <option value="signed">Signed</option>
            <option value="follow-up">Follow-up</option>
          </select>
          <input placeholder="Tags (consult, follow-up, chronic care)" value={editor.tags} onChange={(event) => setEditor((prev) => ({ ...prev, tags: event.target.value }))} />
        </div>
        <div className="input-shell input-shell--compact">
          <select value={editor.appointmentId} onChange={(event) => setEditor((prev) => ({ ...prev, appointmentId: event.target.value }))}>
            <option value="">Link appointment (optional)</option>
            {appointmentOptions.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <select value={editor.visitId} onChange={(event) => setEditor((prev) => ({ ...prev, visitId: event.target.value }))}>
            <option value="">Link visit (optional)</option>
            {visitOptions.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </div>
        <textarea rows={3} placeholder="Assessment" value={editor.assessment} onChange={(event) => setEditor((prev) => ({ ...prev, assessment: event.target.value }))} />
        <textarea rows={3} placeholder="Plan" value={editor.plan} onChange={(event) => setEditor((prev) => ({ ...prev, plan: event.target.value }))} />
        <textarea rows={2} placeholder="Follow-up instructions" value={editor.followUp} onChange={(event) => setEditor((prev) => ({ ...prev, followUp: event.target.value }))} />
        <label className="checkbox-row">
          <input type="checkbox" checked={editor.revisitRecommended} onChange={(event) => setEditor((prev) => ({ ...prev, revisitRecommended: event.target.checked }))} />
          <span>Recommend revisit / additional follow-up</span>
        </label>
        <div className="input-shell compact-actions compact-actions--wrap">
          <button className="btn-primary btn-fit" type="button" disabled={loading} onClick={saveReview}>
            {loading ? "Saving..." : editingId ? "Update review" : "Save review"}
          </button>
          {editingId ? (
            <button className="btn-secondary btn-fit" type="button" onClick={() => { setEditingId(null); setEditor(emptyEditor); }}>
              Cancel edit
            </button>
          ) : null}
        </div>
      </div>

      {reviews.length === 0 ? (
        <div className="empty-state">
          <p className="section-title">No formal reviews yet</p>
          <p className="subtle text-sm">After a chart review or completed encounter, add a structured review here.</p>
        </div>
      ) : (
        <div className="stack-md">
          {reviews.map((review) => (
            <article key={review.id} className="card stack-md">
              <div className="panel-header">
                <div>
                  <p className="font-semibold text-lg">{review.title}</p>
                  <p className="subtle text-xs mt-1">{review.status} · Updated {formatDate(review.updatedAt)}</p>
                </div>
                <div className="input-shell compact-actions compact-actions--wrap">
                  <span className="pill">{review.revisitRecommended ? "Revisit suggested" : "No revisit"}</span>
                  <button className="btn-secondary btn-fit" type="button" onClick={() => { setEditingId(review.id); setEditor({ title: review.title, summary: review.summary, assessment: review.assessment || "", plan: review.plan || "", followUp: review.followUp || "", revisitRecommended: review.revisitRecommended, status: review.status, tags: review.tags || "", appointmentId: review.appointmentId || "", visitId: review.visitId || "" }); }}>
                    Edit
                  </button>
                  <button className="btn-secondary btn-fit" type="button" disabled={loading} onClick={() => deleteReview(review.id)}>
                    Delete
                  </button>
                </div>
              </div>
              <div className="stack-sm text-sm">
                <div><strong>Summary:</strong> <span className="subtle">{review.summary}</span></div>
                {review.assessment ? <div><strong>Assessment:</strong> <span className="subtle">{review.assessment}</span></div> : null}
                {review.plan ? <div><strong>Plan:</strong> <span className="subtle">{review.plan}</span></div> : null}
                {review.followUp ? <div><strong>Follow-up:</strong> <span className="subtle">{review.followUp}</span></div> : null}
                {review.tags ? <div><strong>Tags:</strong> <span className="subtle">{review.tags}</span></div> : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
