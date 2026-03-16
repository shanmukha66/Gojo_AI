"use client";

import { useEffect, useState } from "react";

type PatientSummary = {
  id?: string;
  name?: string;
  age?: number;
  risk?: number;
  signals?: string[];
};

type RagResult = {
  id: string;
  name: string;
  age: number;
  risk: number;
  description: string;
  score: number;
  signals?: string[];
};

type Evidence = {
  visits: { id?: string; start?: string; type?: string }[];
  conditions: { code?: string }[];
};

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || "Unexpected response" };
  }
}

export default function DoctorDashboard() {
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [ragQuery, setRagQuery] = useState("");
  const [ragResults, setRagResults] = useState<RagResult[]>([]);
  const [ragLoading, setRagLoading] = useState(false);
  const [evidence, setEvidence] = useState<Record<string, Evidence>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/doctor/patients?query=${encodeURIComponent(query)}`, {
        cache: "no-store",
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setError(data.error || "Failed to load patients");
        setPatients([]);
      } else {
        setPatients(data.patients || []);
      }
      setLoading(false);
    };
    run();
  }, [query]);

  async function runRag(e: React.FormEvent) {
    e.preventDefault();
    if (!ragQuery.trim()) return;
    setRagLoading(true);
    const res = await fetch(`/api/doctor/rag?query=${encodeURIComponent(ragQuery)}`);
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "RAG search failed");
      setRagResults([]);
    } else {
      setRagResults(data.results || []);
    }
    setRagLoading(false);
  }

  async function runPatientSearch(e: React.FormEvent) {
    e.preventDefault();
    setQuery(searchInput.trim());
  }

  async function loadEvidence(patientId?: string) {
    if (!patientId || evidence[patientId]) return;
    const res = await fetch(`/api/doctor/patient/${patientId}`);
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Failed to load evidence");
      return;
    }
    setEvidence((prev) => ({
      ...prev,
      [patientId]: { visits: data.visits || [], conditions: data.conditions || [] },
    }));
  }

  const patientsWithId = patients.filter((p) => p.id && p.id !== "undefined");

  return (
    <div className="grid gap-6">
      <div className="card-contrast">
        <div className="panel-header">
          <div>
            <p className="section-title">Doctor Workspace</p>
            <p className="subtle text-sm mt-1">
              Search patient records and review AI secondary suggestions grounded in evidence.
            </p>
          </div>
          <form onSubmit={runPatientSearch} className="flex gap-3 w-full md:w-96">
            <input
              placeholder="Search by name or ID"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button className="btn-secondary" type="submit">
              Search
            </button>
          </form>
        </div>
      </div>

      <div className="card-contrast">
        <p className="section-title">RAG Evidence Search</p>
        <p className="subtle text-sm mt-1">
          Ask a clinical risk question and retrieve the most relevant patient summaries.
        </p>
        <form onSubmit={runRag} className="mt-4 flex flex-wrap gap-3">
          <input
            placeholder="e.g. frequent visits and chronic conditions"
            value={ragQuery}
            onChange={(e) => setRagQuery(e.target.value)}
          />
          <button className="btn-primary">Search</button>
        </form>
        <div className="mt-4 grid gap-3">
          {ragLoading && <div className="subtle">Searching...</div>}
          {ragResults.map((result, index) => (
            <div key={`rag-${result.id ?? index}`} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold">{result.name}</p>
                  <p className="subtle text-sm">ID {result.id} · Age {result.age}</p>
                </div>
                <div className="badge" style={{ background: "rgba(106, 163, 255, 0.15)", color: "#bcd4ff" }}>
                  Score {(result.score * 100).toFixed(1)}%
                </div>
              </div>
              <p className="subtle text-sm mt-3">{result.description}</p>
            </div>
          ))}
        </div>
      </div>

      {error && !error.toLowerCase().includes("missing patient id") && (
        <div className="card">{error}</div>
      )}

      {loading ? (
        <div className="card">Loading patient summaries...</div>
      ) : patientsWithId.length === 0 ? (
        <div className="card">No patients found for "{query || "(empty)"}". Try a different ID or clear the search.</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {patientsWithId.map((patient, index) => {
            const id = patient.id ?? `unknown-${index}`;
            const ageLabel = patient.age && patient.age > 0 ? String(patient.age) : "—";
            const risk = patient.risk ?? 0.43;
            const signals = patient.signals ?? ["Review labs", "Check medication interactions"];
            const hasEvidence = patient.id && evidence[patient.id];

            return (
              <div key={`patient-${index}`} className="card">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-lg font-semibold">{patient.name ?? "Patient"}</p>
                    <p className="subtle text-sm">ID: {patient.id ?? "Unknown"} · Age {ageLabel}</p>
                  </div>
                  <div className="badge" style={{ background: "rgba(245, 179, 81, 0.16)", color: "#f5b351" }}>
                    Risk {Math.round(risk * 100)}%
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-sm font-semibold">Secondary suggestions</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {signals.map((signal, sIndex) => (
                      <li key={`${id}-sig-${sIndex}`}>• {signal}</li>
                    ))}
                  </ul>
                </div>
                <button
                  className="btn-secondary w-full mt-4"
                  onClick={() => loadEvidence(patient.id)}
                  disabled={!patient.id}
                >
                  Open evidence
                </button>
                {patient.id && hasEvidence && (
                  <div className="mt-4 text-sm">
                    <p className="font-semibold">Recent visits</p>
                    <ul className="subtle mt-2 space-y-1">
                      {evidence[patient.id].visits.slice(0, 5).map((visit, vIndex) => (
                        <li key={`${id}-visit-${vIndex}`}>
                          • {visit.start || "Unknown date"} · Type {visit.type ?? "-"}
                        </li>
                      ))}
                    </ul>
                    <p className="font-semibold mt-3">Conditions</p>
                    <div className="subtle mt-2">
                      {evidence[patient.id].conditions.length === 0
                        ? "No conditions recorded"
                        : evidence[patient.id].conditions.map((c, cIndex) => (
                            <span key={`${id}-cond-${cIndex}`}>
                              {c.code}
                              {cIndex < evidence[patient.id].conditions.length - 1 ? ", " : ""}
                            </span>
                          ))}
                    </div>
                  </div>
                )}
                {patient.id && !hasEvidence && (
                  <div className="subtle text-sm mt-3">No evidence loaded yet. Click Open evidence.</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
