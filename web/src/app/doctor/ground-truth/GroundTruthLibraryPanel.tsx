"use client";

import { useEffect, useState } from "react";

type Source = {
  id: string;
  title: string;
  sourceType: string;
  specialty: string | null;
  tags: string | null;
  content: string;
  active: boolean;
  updatedAt: string;
};

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || "Unexpected response" };
  }
}

export default function GroundTruthLibraryPanel() {
  const [sources, setSources] = useState<Source[]>([]);
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState("guideline");
  const [specialty, setSpecialty] = useState("");
  const [tags, setTags] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/doctor/ground-truth", { cache: "no-store" });
    const data = await readJson(res);
    if (res.ok) setSources(data.sources || []);
    else setError(data.error || "Unable to load ground truth sources");
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/doctor/ground-truth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, sourceType, specialty, tags, content }),
    });
    const data = await readJson(res);
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Unable to save source");
      return;
    }
    setTitle("");
    setSpecialty("");
    setTags("");
    setContent("");
    await load();
  }

  async function toggle(source: Source) {
    await fetch("/api/doctor/ground-truth", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.id, active: !source.active }),
    });
    await load();
  }

  return (
    <div className="card-grid md:grid-cols-[0.9fr_1.1fr]">
      <section className="card-contrast stack-md">
        <div>
          <p className="section-title">Add trusted source</p>
          <p className="subtle text-sm mt-2">Paste guideline text, textbook notes, discharge instructions, or department-approved snippets. The doctor copilot retrieves from this library before answering.</p>
        </div>
        {error ? <div className="status-banner status-banner--error">{error}</div> : null}
        <form className="stack-sm" onSubmit={save}>
          <input className="form-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Source title" />
          <div className="card-grid card-grid--tight md:grid-cols-2">
            <select className="form-input" value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
              <option value="guideline">Guideline</option>
              <option value="textbook">Textbook</option>
              <option value="hospital_protocol">Hospital protocol</option>
              <option value="manual_note">Manual note</option>
            </select>
            <input className="form-input" value={specialty} onChange={(event) => setSpecialty(event.target.value)} placeholder="Specialty/topic" />
          </div>
          <input className="form-input" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags, e.g. diabetes, CKD, chest pain" />
          <textarea className="form-input" rows={9} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Paste trusted medical ground-truth content here" />
          <button className="btn-primary btn-fit" type="submit" disabled={saving}>{saving ? "Saving..." : "Save ground truth"}</button>
        </form>
      </section>

      <section className="card-contrast stack-md">
        <div className="panel-header">
          <div>
            <p className="section-title">Ground-truth library</p>
            <p className="subtle text-sm mt-2">Active sources are used by doctor copilot retrieval and saved answer memory.</p>
          </div>
          <span className="pill">{sources.filter((source) => source.active).length} active</span>
        </div>
        <div className="stack-sm">
          {sources.length ? sources.map((source) => (
            <article key={source.id} className="surface stack-sm">
              <div className="panel-header">
                <div>
                  <p className="font-semibold">{source.title}</p>
                  <p className="subtle text-xs">{source.sourceType} {source.specialty ? `· ${source.specialty}` : ""}</p>
                </div>
                <button className="btn-secondary btn-fit" type="button" onClick={() => toggle(source)}>{source.active ? "Archive" : "Activate"}</button>
              </div>
              <p className="subtle text-sm">{source.content.slice(0, 260)}{source.content.length > 260 ? "..." : ""}</p>
              {source.tags ? <p className="muted text-xs">Tags: {source.tags}</p> : null}
            </article>
          )) : <div className="empty-state">No database sources yet. The app will temporarily use bundled local CSV snippets until you add trusted sources here.</div>}
        </div>
      </section>
    </div>
  );
}
