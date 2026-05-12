"use client";

import { useState } from "react";

type RagResult = {
  id: string;
  name: string;
  age: number;
  risk: number;
  description: string;
  score: number;
};

const UNAVAILABLE = "Unavailable";

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || "Unexpected response" };
  }
}

function formatRisk(value?: number) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : UNAVAILABLE;
}

export default function DoctorEvidenceSearch() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RagResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function runRag(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    const res = await fetch(`/api/doctor/rag?query=${encodeURIComponent(query)}`, { cache: "no-store" });
    const data = await safeJson(res);

    if (!res.ok) {
      setError(data.error || "RAG search failed");
      setResults([]);
    } else {
      setResults(data.results || []);
    }

    setLoading(false);
  }

  return (
    <section className="card-contrast stack-lg fade-up" style={{ animationDelay: "120ms" }}>
      <div className="panel-header">
        <div>
          <p className="section-title">Evidence Search</p>
          <p className="subtle text-sm mt-2">
            Run retrieval on its own page so patient review stays separate from cohort-level evidence browsing.
          </p>
        </div>
        <span className="pill">RAG</span>
      </div>

      <form onSubmit={runRag} className="stack-md">
        <div className="search-row">
          <input
            placeholder="Ask a clinical question, e.g. recurrent emergency visits with chronic burden"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="btn-primary btn-fit" type="submit">
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
        <p className="muted text-sm">
          Use this page to retrieve similar patients and open the exact patient workspace you want to review next.
        </p>
      </form>

      {error ? (
        <div className="status-banner status-banner--error">
          <strong>Issue</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="empty-state">
          <p className="section-title">Searching evidence</p>
          <p className="subtle text-sm">Running retrieval over embedded patient summaries.</p>
        </div>
      ) : results.length === 0 ? (
        <div className="empty-state">
          <p className="section-title">No evidence results yet</p>
          <p className="subtle text-sm">Run a query to populate the evidence review list.</p>
        </div>
      ) : (
        <div className="result-list">
          {results.map((result, index) => (
            <article key={`rag-result-${result.id ?? index}`} className="result-list__item">
              <div className="panel-header">
                <div>
                  <p className="font-semibold">{result.name || UNAVAILABLE}</p>
                  <p className="subtle text-xs mt-1">
                    ID {result.id || UNAVAILABLE} · Age {result.age ?? UNAVAILABLE} · Risk {formatRisk(result.risk)}
                  </p>
                </div>
                <span className="pill">
                  {typeof result.score === "number" ? `${(result.score * 100).toFixed(1)}%` : UNAVAILABLE}
                </span>
              </div>
              <p className="subtle text-sm leading-7">{result.description || UNAVAILABLE}</p>
              <div className="input-shell">
                <a className="btn-secondary btn-fit" href={`/doctor/patients/${encodeURIComponent(result.id)}/overview`}>
                  Open Patient Chart
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
