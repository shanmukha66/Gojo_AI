"use client";

import { useState } from "react";

type Tip = { title: string; detail: string };

type ApiResponse = {
  tips?: Tip[];
  fallback?: boolean;
  error?: string;
};

const defaultTips: Tip[] = [
  { title: "Stay hydrated", detail: "If you have a fever or diarrhea, sip water or oral rehydration salts regularly." },
  { title: "Watch warning signs", detail: "Severe chest pain, trouble breathing, or confusion require urgent care." },
  { title: "Basic first aid", detail: "Clean minor wounds with water, apply gentle pressure to stop bleeding, and cover." },
];

export default function PatientAssistant() {
  const [query, setQuery] = useState("");
  const [tips, setTips] = useState<Tip[]>(defaultTips);
  const [notice, setNotice] = useState<string>("");
  const [datasetStatus, setDatasetStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setTips(defaultTips);
      setNotice("Showing general first-aid guidance.");
      return;
    }

    setLoading(true);
    setNotice("");
    try {
      const res = await fetch(`/api/patient/firstaid?query=${encodeURIComponent(trimmed)}`);
      const data = (await res.json()) as ApiResponse & { dataset?: { loaded?: boolean; error?: string } };
      if (!res.ok) {
        setNotice(data.error || "Unable to load guidance.");
        setTips(defaultTips);
        return;
      }

      setTips(data.tips && data.tips.length ? data.tips : defaultTips);
      if (data.dataset?.error) {
        setDatasetStatus(`Dataset error: ${data.dataset.error}`);
      } else if (data.dataset && data.dataset.loaded === false) {
        setDatasetStatus("Dataset unavailable.");
      } else {
        setDatasetStatus("");
      }
      if (data.fallback) {
        setNotice("Showing general first-aid guidance for your query.");
      }
    } catch (err) {
      setNotice("Unable to reach the patient guidance service.");
      setTips(defaultTips);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6">
      <div className="card-contrast">
        <p className="section-title">Patient Assistant</p>
        <p className="subtle text-sm mt-1">
          Safe, general first-aid guidance and education. This does not replace professional care.
        </p>
        <form onSubmit={onSearch} className="mt-4 flex flex-wrap gap-3">
          <input
            placeholder="Search symptoms or first-aid topics (e.g., fever, cut, burn)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
        </form>
        {notice ? <p className="subtle mt-3 text-sm">{notice}</p> : null}
        {datasetStatus ? <p className="subtle mt-2 text-xs">{datasetStatus}</p> : null}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {tips.map((tip) => (
          <div key={tip.title} className="card">
            <p className="font-semibold">{tip.title}</p>
            <p className="subtle mt-2 text-sm">{tip.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
