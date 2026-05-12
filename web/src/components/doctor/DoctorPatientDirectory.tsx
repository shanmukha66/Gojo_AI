"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type PatientSummary = {
  id?: string;
  name?: string;
  age?: number;
  risk?: number;
  signals?: string[];
};

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || "Unexpected response" };
  }
}

function formatRisk(value?: number) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "Unavailable";
}

export default function DoctorPatientDirectory() {
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [csvFiles, setCsvFiles] = useState<string[]>([]);
  const [firstLoadedPatientId, setFirstLoadedPatientId] = useState<string | null>(null);
  const [loadingDemo, setLoadingDemo] = useState(false);

  useEffect(() => {
    fetch("/api/doctor/mock-data", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setCsvFiles(data.files || []))
      .catch(() => setCsvFiles([]));
  }, []);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/doctor/patients?query=${encodeURIComponent(query)}`, { cache: "no-store" });
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


  async function loadDemoData(mode: "csv" | "all" = "csv") {
    setLoadingDemo(true);
    setError(null);
    setNotice(null);
    const res = await fetch("/api/doctor/mock-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Failed to load backend CSV mock data");
      setLoadingDemo(false);
      return;
    }
    setNotice(data.mode === "all" ? `Generated varied charts for ${data.patients} patients with ${data.reports} reports, ${data.visits} visits, ${data.appointments} appointments, and ${data.reviews} reviews. Search any patient ID and open the chart.` : `Loaded ${data.patients} realistic patients, ${data.reports} reports, ${data.visits} visits, ${data.appointments} appointments, and ${data.reviews} reviews from backend CSV files.`);
    setCsvFiles(data.files || csvFiles);
    setFirstLoadedPatientId(data.firstPatientId || null);
    setSearchInput("");
    setQuery("");
    const refreshed = await fetch(`/api/doctor/patients?query=`, { cache: "no-store" });
    const refreshedData = await safeJson(refreshed);
    if (refreshed.ok) setPatients(refreshedData.patients || []);
    setLoadingDemo(false);
  }

  const items = useMemo(() => patients.filter((patient) => patient.id && patient.id !== "undefined"), [patients]);

  return (
    <div className="stack-lg fade-up" style={{ animationDelay: "120ms" }}>
      <section className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Patients</p>
            <p className="subtle text-sm mt-2">Keep the directory compact, then open one realistic patient chart into overview, timeline, reports, or reviews.</p>
          </div>
          <span className="pill">5 results max</span>
        </div>

        <div className="surface stack-md">
          <div className="panel-header">
            <div>
              <p className="font-semibold">Backend CSV demo data</p>
              <p className="subtle text-sm mt-1">These files live in <code>web/data/mock_clinical</code>. Click load once, then open any chart below.</p>
            </div>
            <div className="input-shell compact-actions compact-actions--wrap">
              <button className="btn-primary btn-fit" type="button" onClick={() => loadDemoData("all")} disabled={loadingDemo}>
                {loadingDemo ? "Generating..." : "Generate charts for all patients"}
              </button>
              <button className="btn-secondary btn-fit" type="button" onClick={() => loadDemoData("csv")} disabled={loadingDemo}>
                Load 5 CSV showcase patients
              </button>
            </div>
          </div>
          {csvFiles.length ? (
            <div className="tag-row">
              {csvFiles.map((file) => (
                <a key={file} className="tag-row__item" href={`/api/doctor/mock-data?file=${encodeURIComponent(file)}`} target="_blank">
                  {file}
                </a>
              ))}
            </div>
          ) : null}
          {firstLoadedPatientId ? (
            <div className="input-shell compact-actions compact-actions--wrap">
              <Link className="btn-secondary btn-fit" href={`/doctor/patients/${encodeURIComponent(firstLoadedPatientId)}/overview`}>
                Open loaded overview
              </Link>
              <Link className="btn-secondary btn-fit" href={`/doctor/patients/${encodeURIComponent(firstLoadedPatientId)}/timeline`}>
                Open loaded timeline
              </Link>
              <Link className="btn-secondary btn-fit" href={`/doctor/patients/${encodeURIComponent(firstLoadedPatientId)}/reports`}>
                Open loaded reports
              </Link>
            </div>
          ) : null}
        </div>

        {notice ? (
          <div className="status-banner status-banner--success">
            <strong>Demo data ready</strong>
            <span>{notice}</span>
          </div>
        ) : null}

        <form
          className="stack-md"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(searchInput.trim());
          }}
        >
          <div className="search-row">
            <input
              placeholder="Search by patient name or ID"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <button className="btn-primary btn-fit" type="submit">
              Search
            </button>
          </div>
        </form>

        {error ? (
          <div className="status-banner status-banner--error">
            <strong>Issue</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="empty-state">
            <p className="section-title">Loading patients</p>
            <p className="subtle text-sm">Fetching the current result set.</p>
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <p className="section-title">No patients found</p>
            <p className="subtle text-sm">Try a direct patient ID or clear the query to restore the seeded patient set.</p>
          </div>
        ) : (
          <div className="stack-md">
            {items.map((patient) => (
              <article key={patient.id} className="card card--dense stack-md">
                <div className="panel-header">
                  <div>
                    <p className="font-semibold text-lg">{patient.name || `Patient ${patient.id}`}</p>
                    <p className="subtle text-sm mt-1">ID {patient.id} · Age {patient.age ?? "Unavailable"}</p>
                  </div>
                  <span className="pill">Risk {formatRisk(patient.risk)}</span>
                </div>
                {patient.signals?.length ? (
                  <div className="tag-row">
                    {patient.signals.slice(0, 4).map((signal, index) => (
                      <span key={`${patient.id}-signal-${index}`} className="tag-row__item">
                        {signal}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="input-shell compact-actions compact-actions--wrap">
                  <Link className="btn-secondary btn-fit" href={`/doctor/patients/${encodeURIComponent(patient.id!)}/overview`}>
                    Open overview
                  </Link>
                  <Link className="btn-secondary btn-fit" href={`/doctor/patients/${encodeURIComponent(patient.id!)}/timeline`}>
                    Timeline
                  </Link>
                  <Link className="btn-secondary btn-fit" href={`/doctor/patients/${encodeURIComponent(patient.id!)}/reports`}>
                    Reports
                  </Link>
                  <Link className="btn-secondary btn-fit" href={`/doctor/patients/${encodeURIComponent(patient.id!)}/reviews`}>
                    Reviews
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
