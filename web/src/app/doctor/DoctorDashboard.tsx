"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type PatientSummary = {
  id?: string;
  name?: string;
  age?: number;
  risk?: number;
  signals?: string[];
};

type TimelineEvent = {
  at: string | null;
  type: "visit" | "admission" | "discharge" | "report" | "lab" | "appointment";
  title: string;
  description: string;
  sourceCategory: string;
  sourceLink: string | null;
};

type GraphEvidencePath = {
  key: string;
  title: string;
  description: string;
  path: string[];
  sourceCategory: string;
  at: string | null;
};

type WorkspaceDocument = {
  id: string;
  fileName: string;
  mimeType: string;
  status: string;
  reportDate: string | null;
  extractionError: string | null;
  extractedText: string | null;
  chunks: { id: string; chunkIndex: number; content: string }[];
  observations: {
    id: string;
    testName: string;
    valueText: string | null;
    numericValue: number | null;
    unit: string | null;
    referenceRange: string | null;
    abnormalFlag: string | null;
    observedAt: string | null;
  }[];
  timelineImpact: string[];
  sourceCategory: string;
  sourceLink: string;
};

type DecisionReport = {
  title: string;
  summary: string;
  evidenceUsed: string[];
  actionItems: string[];
  cautionPoints: string[];
  clinicianNote: string;
  graphPaths?: GraphEvidencePath[];
  fallback: boolean;
  provenance: {
    evidenceReferences: string[];
    model: string;
    mode: "gpt" | "fallback";
  };
};

type DoctorAnswer = {
  answer: string;
  evidenceSource: string;
  sourceDetails?: string[];
  graphPaths?: GraphEvidencePath[];
  fallback?: boolean;
  provenance?: {
    evidenceReferences: string[];
    model: string;
    mode: "gpt" | "fallback";
  };
};

type PatientMemo = {
  id: string;
  doctorId: string;
  patientId: string;
  title: string;
  body: string;
  status: string;
  tags: string | null;
  createdAt: string;
  updatedAt: string;
};

type SlotOption = {
  doctorId: string;
  doctorName: string | null;
  slotStart: string;
  slotEnd: string;
};

type PatientMemoEditor = {
  title: string;
  body: string;
  status: string;
  tags: string;
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

function formatCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatDate(value?: string | null) {
  if (!value) return UNAVAILABLE;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatEventType(type: TimelineEvent["type"]) {
  switch (type) {
    case "admission":
      return "Admission";
    case "discharge":
      return "Discharge";
    case "report":
      return "Report";
    case "lab":
      return "Lab Finding";
    case "appointment":
      return "Appointment";
    default:
      return "Visit";
  }
}

export default function DoctorDashboard() {
  const recognitionRef = useRef<unknown>(null);
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [activePatientId, setActivePatientId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [timelines, setTimelines] = useState<Record<string, { patient?: PatientSummary; events: TimelineEvent[]; graphPaths: GraphEvidencePath[] }>>({});
  const [documents, setDocuments] = useState<Record<string, WorkspaceDocument[]>>({});
  const [workspaceLoading, setWorkspaceLoading] = useState<Record<string, boolean>>({});
  const [reports, setReports] = useState<Record<string, DecisionReport>>({});
  const [reportLoading, setReportLoading] = useState<string | null>(null);
  const [doctorQuestions, setDoctorQuestions] = useState<Record<string, string>>({});
  const [doctorAnswers, setDoctorAnswers] = useState<Record<string, DoctorAnswer>>({});
  const [questionLoading, setQuestionLoading] = useState<Record<string, boolean>>({});
  const [patientMemos, setPatientMemos] = useState<Record<string, PatientMemo[]>>({});
  const [availableSlots, setAvailableSlots] = useState<SlotOption[]>([]);
  const [patientMemoEditors, setPatientMemoEditors] = useState<Record<string, PatientMemoEditor>>({});
  const [bookingReasons, setBookingReasons] = useState<Record<string, string>>({});
  const [selectedSlots, setSelectedSlots] = useState<Record<string, string>>({});
  const [patientMemoLoading, setPatientMemoLoading] = useState<Record<string, boolean>>({});
  const [editingPatientMemoIds, setEditingPatientMemoIds] = useState<Record<string, string | null>>({});
  const [appointmentActionLoading, setAppointmentActionLoading] = useState<Record<string, boolean>>({});
  const [dictationTarget, setDictationTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      const requestedQuery = query || searchParams.get("patient") || "";
      if (requestedQuery !== query) {
        setQuery(requestedQuery);
        setSearchInput(requestedQuery);
      }
      const res = await fetch(`/api/doctor/patients?query=${encodeURIComponent(requestedQuery)}`, {
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
  }, [query, searchParams]);

  useEffect(() => {
    const loadScheduling = async () => {
      const availabilityRes = await fetch("/api/doctor/availability", { cache: "no-store" });
      const availabilityData = await safeJson(availabilityRes);
      if (availabilityRes.ok) {
        setAvailableSlots(availabilityData.upcomingSlots || []);
      }
    };
    loadScheduling();
  }, []);

  function runPatientSearch(e: React.FormEvent) {
    e.preventDefault();
    setQuery(searchInput.trim());
  }

  async function loadWorkspace(patientId?: string) {
    if (!patientId || workspaceLoading[patientId]) return;
    setWorkspaceLoading((prev) => ({ ...prev, [patientId]: true }));
    setError(null);

    const [timelineRes, documentsRes, memosRes] = await Promise.all([
      fetch(`/api/doctor/patient/${patientId}/timeline`),
      fetch(`/api/doctor/patient/${patientId}/documents`),
      fetch(`/api/doctor/patient/${patientId}/memos`, { cache: "no-store" }),
    ]);

    const [timelineData, documentsData, memosData] = await Promise.all([
      safeJson(timelineRes),
      safeJson(documentsRes),
      safeJson(memosRes),
    ]);

    if (!timelineRes.ok || !documentsRes.ok || !memosRes.ok) {
      setError(
        timelineData.error || documentsData.error || memosData.error || "Failed to load doctor workspace for this patient",
      );
      setWorkspaceLoading((prev) => ({ ...prev, [patientId]: false }));
      return;
    }

    setTimelines((prev) => ({
      ...prev,
      [patientId]: {
        patient: timelineData.patient,
        events: timelineData.events || [],
        graphPaths: timelineData.graphPaths || [],
      },
    }));
    setDocuments((prev) => ({
      ...prev,
      [patientId]: documentsData.documents || [],
    }));
    setPatientMemos((prev) => ({
      ...prev,
      [patientId]: memosData.memos || [],
    }));
    setPatientMemoEditors((prev) => ({
      ...prev,
      [patientId]:
        prev[patientId] || {
          title: "",
          body: "",
          status: "open",
          tags: "",
        },
    }));
    setWorkspaceLoading((prev) => ({ ...prev, [patientId]: false }));
  }

  async function savePatientMemo(patientId?: string, memoId?: string) {
    if (!patientId || patientMemoLoading[patientId]) return;
    const editor = patientMemoEditors[patientId];
    const title = editor?.title.trim();
    const body = editor?.body.trim();
    if (!title || !body) {
      setError("Patient memo title and body are required");
      return;
    }

    setPatientMemoLoading((prev) => ({ ...prev, [patientId]: true }));
    setError(null);
    const res = await fetch(
      memoId
        ? `/api/doctor/patient/${patientId}/memos/${memoId}`
        : `/api/doctor/patient/${patientId}/memos`,
      {
        method: memoId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          status: editor.status,
          tags: editor.tags.trim() || null,
        }),
      },
    );
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Failed to save patient memo");
      setPatientMemoLoading((prev) => ({ ...prev, [patientId]: false }));
      return;
    }

    const refreshed = await fetch(`/api/doctor/patient/${patientId}/memos`, { cache: "no-store" });
    const refreshedData = await safeJson(refreshed);
    if (refreshed.ok) {
      setPatientMemos((prev) => ({
        ...prev,
        [patientId]: refreshedData.memos || [],
      }));
      setPatientMemoEditors((prev) => ({
        ...prev,
        [patientId]: { title: "", body: "", status: "open", tags: "" },
      }));
      setEditingPatientMemoIds((prev) => ({ ...prev, [patientId]: null }));
    }
    setPatientMemoLoading((prev) => ({ ...prev, [patientId]: false }));
  }

  async function deletePatientMemoEntry(patientId?: string, memoId?: string) {
    if (!patientId || !memoId || patientMemoLoading[patientId]) return;
    setPatientMemoLoading((prev) => ({ ...prev, [patientId]: true }));
    setError(null);
    const res = await fetch(`/api/doctor/patient/${patientId}/memos/${memoId}`, { method: "DELETE" });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Failed to delete patient memo");
      setPatientMemoLoading((prev) => ({ ...prev, [patientId]: false }));
      return;
    }

    const refreshed = await fetch(`/api/doctor/patient/${patientId}/memos`, { cache: "no-store" });
    const refreshedData = await safeJson(refreshed);
    if (refreshed.ok) {
      setPatientMemos((prev) => ({
        ...prev,
        [patientId]: refreshedData.memos || [],
      }));
      if (editingPatientMemoIds[patientId] === memoId) {
        setPatientMemoEditors((prev) => ({
          ...prev,
          [patientId]: { title: "", body: "", status: "open", tags: "" },
        }));
        setEditingPatientMemoIds((prev) => ({ ...prev, [patientId]: null }));
      }
    }
    setPatientMemoLoading((prev) => ({ ...prev, [patientId]: false }));
  }

  async function refreshScheduling() {
    const availabilityRes = await fetch("/api/doctor/availability", { cache: "no-store" });
    const availabilityData = await safeJson(availabilityRes);
    if (availabilityRes.ok) {
      setAvailableSlots(availabilityData.upcomingSlots || []);
    }
  }

  async function bookForPatient(patientId?: string) {
    if (!patientId) return;
    const slotStart = selectedSlots[patientId];
    const slot = availableSlots.find((item) => item.slotStart === slotStart);
    const reason = bookingReasons[patientId]?.trim();
    if (!slot || !reason) {
      setError("Choose a slot and add a booking reason before creating the appointment.");
      return;
    }

    setAppointmentActionLoading((prev) => ({ ...prev, [patientId]: true }));
    const res = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientRecordId: patientId,
        slotStart: slot.slotStart,
        slotEnd: slot.slotEnd,
        reason,
      }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Failed to create appointment");
    } else {
      await refreshScheduling();
      setBookingReasons((prev) => ({ ...prev, [patientId]: "" }));
    }
    setAppointmentActionLoading((prev) => ({ ...prev, [patientId]: false }));
  }

  function startDictation(target: { kind: "patient"; patientId?: string; field: "title" | "body" }) {
    const SpeechRecognitionCtor =
      typeof window !== "undefined"
        ? ((window as typeof window & {
            SpeechRecognition?: new () => {
              continuous: boolean;
              interimResults: boolean;
              lang: string;
              start: () => void;
              stop: () => void;
              onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
              onerror: ((event: { error?: string }) => void) | null;
              onend: (() => void) | null;
            };
            webkitSpeechRecognition?: new () => {
              continuous: boolean;
              interimResults: boolean;
              lang: string;
              start: () => void;
              stop: () => void;
              onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
              onerror: ((event: { error?: string }) => void) | null;
              onend: (() => void) | null;
            };
          }).SpeechRecognition ||
            (window as typeof window & { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition)
        : null;

    if (!SpeechRecognitionCtor) {
      setError("Speech-to-text is unavailable in this browser");
      return;
    }

    if (recognitionRef.current && typeof (recognitionRef.current as { stop?: () => void }).stop === "function") {
      (recognitionRef.current as { stop: () => void }).stop();
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();

      if (!transcript) return;

      if (target.patientId) {
        const patientId = target.patientId;
        setPatientMemoEditors((prev) => ({
          ...prev,
          [patientId]: {
            ...(prev[patientId] || { title: "", body: "", status: "open", tags: "" }),
            [target.field]: `${prev[patientId]?.[target.field] || ""} ${transcript}`.trim(),
          },
        }));
      }
    };
    recognition.onerror = (event) => {
      setError(event.error ? `Speech capture failed: ${event.error}` : "Speech capture failed");
    };
    recognition.onend = () => {
      setDictationTarget(null);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    setDictationTarget(`${target.kind}:${target.patientId || "self"}:${target.field}`);
    recognition.start();
  }

  async function loadReport(patientId?: string) {
    if (!patientId || reports[patientId]) return;
    setReportLoading(patientId);
    setError(null);
    const res = await fetch(`/api/doctor/report/${patientId}/generate`, {
      method: "POST",
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Failed to generate report");
      setReportLoading(null);
      return;
    }
    setReports((prev) => ({
      ...prev,
      [patientId]: data.report,
    }));
    setReportLoading(null);
  }

  async function askDoctorWorkspace(patientId?: string) {
    if (!patientId || questionLoading[patientId]) return;
    const queryText = doctorQuestions[patientId]?.trim();
    if (!queryText) return;

    setQuestionLoading((prev) => ({ ...prev, [patientId]: true }));
    setError(null);
    const res = await fetch(`/api/doctor/copilot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId, query: queryText }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Doctor Q&A failed");
      setQuestionLoading((prev) => ({ ...prev, [patientId]: false }));
      return;
    }
    setDoctorAnswers((prev) => ({ ...prev, [patientId]: data }));
    setQuestionLoading((prev) => ({ ...prev, [patientId]: false }));
  }

  const patientsWithId = useMemo(
    () => patients.filter((patient) => patient.id && patient.id !== "undefined"),
    [patients],
  );

  const activePatient = useMemo(
    () =>
      patientsWithId.find((patient) => patient.id === activePatientId) ||
      patientsWithId[0] ||
      undefined,
    [activePatientId, patientsWithId],
  );

  const summaryStats = useMemo(() => {
    const highRisk = patientsWithId.filter((patient) => (patient.risk ?? 0) >= 0.75).length;
    const avgRisk =
      patientsWithId.length > 0
        ? patientsWithId.reduce((sum, patient) => sum + (patient.risk ?? 0), 0) / patientsWithId.length
        : undefined;

    return {
      totalPatients: patientsWithId.length,
      highRisk,
      avgRisk,
      ragResults: activePatient ? 1 : 0,
    };
  }, [activePatient, patientsWithId]);

  return (
    <div className="dashboard-grid">
      <section className="card-contrast stack-md">
        <div className="workspace-toolbar">
          <div>
            <p className="section-title">Today&apos;s Workspace</p>
            <p className="subtle text-sm mt-2">
              Keep the list short, pick one patient, and review that chart without the page getting crowded.
            </p>
          </div>
          <div className="workspace-toolbar__stats">
            <div className="toolbar-stat">
              <span className="toolbar-stat__label">Patients</span>
              <strong>{summaryStats.totalPatients}</strong>
            </div>
            <div className="toolbar-stat">
              <span className="toolbar-stat__label">High risk</span>
              <strong>{summaryStats.highRisk}</strong>
            </div>
            <div className="toolbar-stat">
              <span className="toolbar-stat__label">Average</span>
              <strong>{summaryStats.avgRisk ? formatRisk(summaryStats.avgRisk) : UNAVAILABLE}</strong>
            </div>
          <div className="toolbar-stat">
              <span className="toolbar-stat__label">Selected</span>
              <strong>{summaryStats.ragResults}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="dashboard-grid dashboard-grid--workspace">
        <aside className="card-contrast stack-lg">
          <div className="panel-header">
            <div>
              <p className="section-title">Patient Search</p>
              <p className="subtle text-sm mt-2">
                Search by patient name or ID, then choose one patient to keep the workspace focused.
              </p>
            </div>
            <span className="pill">Search</span>
          </div>
          <form onSubmit={runPatientSearch} className="stack-md">
            <div className="search-row">
              <input
                placeholder="Search by patient name or ID"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
              <button className="btn-primary" type="submit">
                Search
              </button>
            </div>
            <p className="muted text-sm">Direct ID search works best. Clearing the field restores the seeded patient set.</p>
          </form>

          {loading ? (
            <div className="empty-state">
              <p className="section-title">Loading patients</p>
              <p className="subtle text-sm">Fetching the current patient result set.</p>
            </div>
          ) : patientsWithId.length === 0 ? (
            <div className="empty-state">
              <p className="section-title">No patients found</p>
              <p className="subtle text-sm">
                No patients matched <strong>{query || "(empty)"}</strong>. Try another identifier or clear the search.
              </p>
            </div>
          ) : (
            <div className="patient-picker-list">
              {patientsWithId.map((patient, index) => {
                const patientId = patient.id ?? `unknown-${index}`;
                const isActive = patientId === activePatient?.id;
                return (
                  <button
                    key={`patient-picker-${patientId}-${index}`}
                    type="button"
                    className={`patient-picker ${isActive ? "patient-picker--active" : ""}`}
                    onClick={() => setActivePatientId(patient.id || null)}
                  >
                    <div>
                      <p className="font-semibold">{patient.name || UNAVAILABLE}</p>
                      <p className="subtle text-sm mt-1">
                        ID {patient.id || UNAVAILABLE} · Age {patient.age ?? UNAVAILABLE}
                      </p>
                    </div>
                    <span className="pill">Risk {formatRisk(patient.risk)}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="surface stack-sm">
            <p className="eyebrow">Quick Links</p>
            <div className="compact-link-list">
              <a className="compact-link" href="/doctor/evidence">
                <span className="font-semibold">Evidence search</span>
                <span className="subtle text-sm">RAG search and retrieved patient summaries</span>
              </a>
              <a className="compact-link" href="/doctor/memos">
                <span className="font-semibold">Doctor memos</span>
                <span className="subtle text-sm">Private notes and reminders</span>
              </a>
              <a className="compact-link" href="/doctor/schedule">
                <span className="font-semibold">Schedule</span>
                <span className="subtle text-sm">Availability and appointments</span>
              </a>
            </div>
          </div>
        </aside>

        <div className="card-contrast stack-lg">
          <div className="panel-header">
            <div>
              <p className="section-title">Patient Workspace</p>
              <p className="subtle text-sm mt-2">
                Review one selected chart at a time so the context stays accurate and the page stays usable in real sessions.
              </p>
            </div>
            <span className="pill">Active Chart</span>
          </div>

          {error ? (
            <div className="status-banner status-banner--error">
              <strong>Issue</strong>
              <span>{error}</span>
            </div>
          ) : (
            <div className="status-banner status-banner--success">
              <strong>Ready</strong>
              <span className="subtle text-sm">Timeline, reports, and clinician Q&amp;A are available for the selected patient.</span>
            </div>
          )}

          {!activePatient ? (
            <div className="empty-state">
              <p className="section-title">No patient selected</p>
              <p className="subtle text-sm">Search for a patient and choose one result to open the detailed workspace.</p>
            </div>
          ) : (() => {
              const patient = activePatient;
              const id = patient.id ?? "unknown";
              const ageLabel = patient.age && patient.age > 0 ? String(patient.age) : UNAVAILABLE;
              const riskLabel = formatRisk(patient.risk);
              const signals = patient.signals && patient.signals.length > 0 ? patient.signals : [UNAVAILABLE];
              const loadedTimeline = patient.id ? timelines[patient.id] : undefined;
              const loadedDocuments = patient.id ? documents[patient.id] : undefined;
              const loadedReport = patient.id ? reports[patient.id] : undefined;
              const answer = patient.id ? doctorAnswers[patient.id] : undefined;

              return (
                <article key={`patient-${id}`} className="stack-lg">
                  <div className="panel-header">
                    <div>
                      <p className="text-2xl font-semibold">{patient.name || UNAVAILABLE}</p>
                      <p className="subtle text-sm mt-1">ID {patient.id || UNAVAILABLE} · Age {ageLabel}</p>
                    </div>
                    <span
                      className="badge"
                      style={{ background: "color-mix(in srgb, var(--accent-2) 16%, transparent)", color: "var(--accent-2)" }}
                    >
                      Risk {riskLabel}
                    </span>
                  </div>

                  <div className="surface stack-md">
                    <div>
                      <p className="eyebrow">Summary</p>
                      <p className="text-lg font-semibold mt-2">Secondary suggestions</p>
                    </div>
                    <div className="list">
                      {signals.map((signal, signalIndex) => (
                        <div key={`${id}-signal-${signalIndex}`}>• {signal}</div>
                      ))}
                    </div>
                  </div>
                  <div className="surface stack-md">
                    <div className="panel-header">
                      <div>
                        <p className="eyebrow">Timeline</p>
                        <p className="text-lg font-semibold mt-2">Patient timeline workspace</p>
                      </div>
                      {loadedTimeline ? (
                        <span className="pill">{formatCountLabel(loadedTimeline.events.length, "event")}</span>
                      ) : null}
                    </div>

                    {loadedTimeline ? (
                      <div className="stack-md text-sm">
                        {loadedTimeline.events.slice(0, 8).map((event, eventIndex) => (
                          <div key={`${id}-event-${eventIndex}`} className="card stack-sm">
                            <div className="panel-header">
                              <div>
                                <p className="font-semibold">{event.title}</p>
                                <p className="subtle text-xs mt-1">
                                  {formatDate(event.at)} · {formatEventType(event.type)}
                                </p>
                              </div>
                              <span className="pill">{event.sourceCategory || UNAVAILABLE}</span>
                            </div>
                            <p className="subtle leading-7">{event.description || UNAVAILABLE}</p>
                            <p className="muted text-xs">
                              Source {event.sourceLink ? `ID ${event.sourceLink}` : event.sourceCategory || UNAVAILABLE}
                            </p>
                          </div>
                        ))}
                        <div className="card stack-sm">
                          <div className="panel-header">
                            <div>
                              <p className="font-semibold">Knowledge graph evidence paths</p>
                              <p className="subtle text-xs mt-1">Expanded patient-document, patient-lab, patient-appointment, memo, and care-episode relations.</p>
                            </div>
                            <span className="pill">{formatCountLabel(loadedTimeline.graphPaths.length, "path")}</span>
                          </div>
                          {loadedTimeline.graphPaths.length > 0 ? (
                            <div className="stack-sm">
                              {loadedTimeline.graphPaths.slice(0, 5).map((path, pathIndex) => (
                                <div key={`${id}-graph-path-${pathIndex}`} className="surface stack-sm">
                                  <div className="panel-header">
                                    <div>
                                      <p className="font-semibold">{path.title}</p>
                                      <p className="subtle text-xs mt-1">{path.sourceCategory} · {formatDate(path.at)}</p>
                                    </div>
                                  </div>
                                  <p className="subtle leading-7">{path.description}</p>
                                  <p className="muted text-xs">{path.path.join(" -> ")}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="subtle text-sm">Graph evidence paths are unavailable until this patient workspace has enough linked evidence.</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="empty-state">
                        <p className="section-title">Timeline unavailable</p>
                        <p className="subtle text-sm">Open the patient workspace to load visits, admissions, discharges, reports, and extracted findings.</p>
                      </div>
                    )}
                  </div>

                  <div className="surface stack-md">
                    <div className="panel-header">
                      <div>
                        <p className="eyebrow">Reports</p>
                        <p className="text-lg font-semibold mt-2">Report evidence panel</p>
                      </div>
                      {loadedDocuments ? (
                        <span className="pill">{formatCountLabel(loadedDocuments.length, "report")}</span>
                      ) : null}
                    </div>

                    {loadedDocuments && loadedDocuments.length > 0 ? (
                      <div className="stack-md">
                        {loadedDocuments.slice(0, 3).map((document) => (
                          <div key={`${id}-document-${document.id}`} className="card stack-md">
                            <div className="panel-header">
                              <div>
                                <p className="font-semibold">{document.fileName}</p>
                                <p className="subtle text-xs mt-1">
                                  {document.status} · Report date {formatDate(document.reportDate)}
                                </p>
                              </div>
                              <span className="pill">{document.sourceCategory}</span>
                            </div>

                            <div className="stack-sm text-sm">
                              <p className="font-semibold">Structured findings</p>
                              <p className="subtle leading-7">
                                {document.observations.length > 0
                                  ? document.observations
                                      .slice(0, 6)
                                      .map((obs) => {
                                        const pieces = [obs.testName];
                                        if (obs.valueText) pieces.push(`${obs.valueText}${obs.unit ? ` ${obs.unit}` : ""}`);
                                        if (obs.referenceRange) pieces.push(`ref ${obs.referenceRange}`);
                                        if (obs.abnormalFlag) pieces.push(obs.abnormalFlag);
                                        return pieces.join(" · ");
                                      })
                                      .join(", ")
                                  : UNAVAILABLE}
                              </p>
                            </div>

                            <div className="stack-sm text-sm">
                              <p className="font-semibold">Timeline impact</p>
                              <div className="list">
                                {document.timelineImpact.map((item, impactIndex) => (
                                  <div key={`${document.id}-impact-${impactIndex}`}>• {item}</div>
                                ))}
                              </div>
                            </div>

                            <div className="stack-sm text-sm">
                              <p className="font-semibold">Extracted report text</p>
                              <p className="subtle leading-7">
                                {document.extractedText
                                  ? `${document.extractedText.slice(0, 420)}${document.extractedText.length > 420 ? "..." : ""}`
                                  : document.extractionError || UNAVAILABLE}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : loadedDocuments ? (
                      <div className="empty-state">
                        <p className="section-title">No uploaded reports</p>
                        <p className="subtle text-sm">This patient record does not yet have any linked uploaded reports available to the doctor workspace.</p>
                      </div>
                    ) : (
                      <div className="empty-state">
                        <p className="section-title">Report evidence unavailable</p>
                        <p className="subtle text-sm">Open the patient workspace to load extracted report text and structured findings.</p>
                      </div>
                    )}
                  </div>

                  <div className="surface stack-md">
                    <div>
                      <p className="eyebrow">Action</p>
                      <p className="text-lg font-semibold mt-2">Timeline review, report summary, and grounded clinician Q&amp;A</p>
                    </div>

                    <div className="input-shell">
                      <button className="btn-secondary" onClick={() => loadWorkspace(patient.id)} disabled={!patient.id || workspaceLoading[id]}>
                        {workspaceLoading[id] ? "Loading workspace..." : "Open timeline & reports"}
                      </button>
                      <button
                        className="btn-primary"
                        onClick={() => loadReport(patient.id)}
                        disabled={!patient.id || reportLoading === patient.id}
                      >
                        {reportLoading === patient.id ? "Generating..." : "Generate decision report"}
                      </button>
                    </div>

                    <div className="stack-sm">
                      <label className="eyebrow" htmlFor={`doctor-question-${id}`}>
                        Doctor Q&amp;A
                      </label>
                      <div className="input-shell">
                        <input
                          id={`doctor-question-${id}`}
                          placeholder="Ask about the report, timeline, or evidence bundle"
                          value={doctorQuestions[id] || ""}
                          onChange={(event) =>
                            setDoctorQuestions((prev) => ({
                              ...prev,
                              [id]: event.target.value,
                            }))
                          }
                        />
                        <button
                          className="btn-primary"
                          onClick={() => askDoctorWorkspace(patient.id)}
                          disabled={!patient.id || questionLoading[id]}
                        >
                          {questionLoading[id] ? "Answering..." : "Ask"}
                        </button>
                      </div>
                    </div>

                    {answer ? (
                      <div className="card stack-md">
                        <div className="panel-header">
                          <div>
                            <p className="font-semibold text-lg">Doctor copilot answer</p>
                            <p className="subtle text-sm mt-1">{answer.evidenceSource || UNAVAILABLE}</p>
                          </div>
                          <span className="pill">{answer.provenance?.mode === "gpt" ? "GPT-grounded" : "Deterministic"}</span>
                        </div>
                        <p className="subtle text-sm leading-7">{answer.answer || UNAVAILABLE}</p>
                        <div className="list text-sm">
                          {(answer.sourceDetails || []).map((item, sourceIndex) => (
                            <div key={`${id}-source-${sourceIndex}`}>• {item}</div>
                          ))}
                        </div>
                        {(answer.graphPaths || []).length > 0 ? (
                          <div className="stack-sm text-sm">
                            <p className="font-semibold">Graph evidence paths</p>
                            <div className="list">
                              {answer.graphPaths?.slice(0, 4).map((path, pathIndex) => (
                                <div key={`${id}-answer-graph-${pathIndex}`}>
                                  • {path.path.join(" -> ")} · {path.description}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="stack-sm text-sm">
                          <p className="font-semibold">Audit / provenance</p>
                          <p className="subtle">Model: {answer.provenance?.model || UNAVAILABLE}</p>
                          <p className="subtle">Mode: {answer.provenance?.mode || UNAVAILABLE}</p>
                          <div className="list">
                            {(answer.provenance?.evidenceReferences || []).slice(0, 6).map((item, idx) => (
                              <div key={`${id}-copilot-prov-${idx}`}>• {item}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="subtle text-sm">No doctor-side answer yet. Ask about uploaded reports, timeline changes, extracted lab findings, or memo context.</p>
                    )}

                    {loadedReport ? (
                      <div className="card stack-md">
                        <div>
                          <p className="font-semibold text-lg">{loadedReport.title}</p>
                          <p className="subtle text-sm mt-2">{loadedReport.summary}</p>
                        </div>
                        <div className="stack-sm text-sm">
                          <p className="font-semibold">Evidence used</p>
                          <div className="list">
                            {loadedReport.evidenceUsed.map((item, evidenceIndex) => (
                              <div key={`${id}-report-evidence-${evidenceIndex}`}>• {item}</div>
                            ))}
                          </div>
                        </div>
                        <div className="stack-sm text-sm">
                          <p className="font-semibold">Action items</p>
                          <div className="list">
                            {loadedReport.actionItems.map((item, actionIndex) => (
                              <div key={`${id}-report-action-${actionIndex}`}>• {item}</div>
                            ))}
                          </div>
                        </div>
                        <div className="stack-sm text-sm">
                          <p className="font-semibold">Caution points</p>
                          <div className="list">
                            {loadedReport.cautionPoints.map((item, cautionIndex) => (
                              <div key={`${id}-report-caution-${cautionIndex}`}>• {item}</div>
                            ))}
                          </div>
                        </div>
                        {(loadedReport.graphPaths || []).length > 0 ? (
                          <div className="stack-sm text-sm">
                            <p className="font-semibold">Graph evidence paths</p>
                            <div className="list">
                              {loadedReport.graphPaths?.slice(0, 4).map((path, graphIndex) => (
                                <div key={`${id}-report-graph-${graphIndex}`}>
                                  • {path.path.join(" -> ")} · {path.description}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="stack-sm text-sm">
                          <p className="font-semibold">Audit / provenance</p>
                          <p className="subtle">Model: {loadedReport.provenance?.model || UNAVAILABLE}</p>
                          <p className="subtle">Mode: {loadedReport.provenance?.mode || UNAVAILABLE}</p>
                          <div className="list">
                            {(loadedReport.provenance?.evidenceReferences || []).slice(0, 6).map((item, provIndex) => (
                              <div key={`${id}-report-prov-${provIndex}`}>• {item}</div>
                            ))}
                          </div>
                        </div>
                        <p className="subtle text-sm">{loadedReport.clinicianNote}</p>
                      </div>
                    ) : (
                      <p className="subtle text-sm">
                        Decision report {UNAVAILABLE}. Generate a report after opening the patient workspace if you want a synthesized note.
                      </p>
                    )}
                  </div>

                  <div className="surface stack-md">
                    <div className="panel-header">
                      <div>
                        <p className="eyebrow">Direct Booking</p>
                        <p className="text-lg font-semibold mt-2">Create an appointment for this patient</p>
                      </div>
                      <span className="pill">Doctor Direct Book</span>
                    </div>
                    <div className="form-stack-compact">
                      <div className="input-shell">
                        <select
                          value={selectedSlots[id] || ""}
                          onChange={(event) => setSelectedSlots((prev) => ({ ...prev, [id]: event.target.value }))}
                        >
                          <option value="">Choose one of your upcoming slots</option>
                          {availableSlots.map((slot) => (
                            <option key={`${id}-${slot.slotStart}`} value={slot.slotStart}>
                              {formatDate(slot.slotStart)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <textarea
                        placeholder="Reason for direct booking"
                        value={bookingReasons[id] || ""}
                        onChange={(event) => setBookingReasons((prev) => ({ ...prev, [id]: event.target.value }))}
                        rows={3}
                      />
                      <button
                        className="btn-primary btn-fit"
                        type="button"
                        disabled={appointmentActionLoading[id]}
                        onClick={() => bookForPatient(patient.id)}
                      >
                        {appointmentActionLoading[id] ? "Booking..." : "Book for Patient"}
                      </button>
                    </div>
                  </div>

                  <div className="surface stack-md">
                    <div className="panel-header">
                      <div>
                        <p className="eyebrow">Patient Memo</p>
                        <p className="text-lg font-semibold mt-2">Clinical memo for this patient</p>
                      </div>
                      {patientMemos[id] ? <span className="pill">{formatCountLabel(patientMemos[id].length, "memo")}</span> : null}
                    </div>

                    <div className="form-stack-compact">
                      <input
                        placeholder="Patient memo title"
                        value={patientMemoEditors[id]?.title || ""}
                        onChange={(event) =>
                          setPatientMemoEditors((prev) => ({
                            ...prev,
                            [id]: { ...(prev[id] || { title: "", body: "", status: "open", tags: "" }), title: event.target.value },
                          }))
                        }
                      />
                      <div className="input-shell input-shell--compact">
                        <select
                          value={patientMemoEditors[id]?.status || "open"}
                          onChange={(event) =>
                            setPatientMemoEditors((prev) => ({
                              ...prev,
                              [id]: { ...(prev[id] || { title: "", body: "", status: "open", tags: "" }), status: event.target.value },
                            }))
                          }
                        >
                          <option value="open">Open</option>
                          <option value="follow-up">Follow-up</option>
                          <option value="done">Done</option>
                        </select>
                        <input
                          placeholder="Tags (e.g. follow-up, labs)"
                          value={patientMemoEditors[id]?.tags || ""}
                          onChange={(event) =>
                            setPatientMemoEditors((prev) => ({
                              ...prev,
                              [id]: { ...(prev[id] || { title: "", body: "", status: "open", tags: "" }), tags: event.target.value },
                            }))
                          }
                        />
                      </div>
                      <textarea
                        placeholder="Write clinical observations, treatment/report notes, or reminders for next visit"
                        value={patientMemoEditors[id]?.body || ""}
                        onChange={(event) =>
                          setPatientMemoEditors((prev) => ({
                            ...prev,
                            [id]: { ...(prev[id] || { title: "", body: "", status: "open", tags: "" }), body: event.target.value },
                          }))
                        }
                        rows={5}
                      />
                      <div className="input-shell">
                        <button
                          className="btn-secondary btn-fit"
                          type="button"
                          onClick={() => startDictation({ kind: "patient", patientId: id, field: "body" })}
                        >
                          {dictationTarget === `patient:${id}:body` ? "Listening..." : "Dictate patient memo"}
                        </button>
                        <button
                          className="btn-primary btn-fit"
                          type="button"
                          onClick={() => savePatientMemo(patient.id, editingPatientMemoIds[id] || undefined)}
                          disabled={patientMemoLoading[id]}
                        >
                          {patientMemoLoading[id] ? "Saving..." : editingPatientMemoIds[id] ? "Update patient memo" : "Save patient memo"}
                        </button>
                      </div>
                    </div>

                    {patientMemos[id] && patientMemos[id].length > 0 ? (
                      <div className="stack-md">
                        {patientMemos[id].slice(0, 5).map((memo) => (
                          <div key={memo.id} className="card stack-sm">
                            <div className="panel-header">
                              <div>
                                <p className="font-semibold">{memo.title}</p>
                            <p className="subtle text-xs mt-1">
                                  {memo.status} · Updated {formatDate(memo.updatedAt)} · Doctor-scoped review
                                </p>
                              </div>
                              <div className="input-shell">
                                <button
                                  className="btn-secondary"
                                  type="button"
                                  onClick={() =>
                                    {
                                      setPatientMemoEditors((prev) => ({
                                        ...prev,
                                        [id]: {
                                          title: memo.title,
                                          body: memo.body,
                                          status: memo.status,
                                          tags: memo.tags || "",
                                        },
                                      }));
                                      setEditingPatientMemoIds((prev) => ({ ...prev, [id]: memo.id }));
                                    }
                                  }
                                >
                                  Edit draft
                                </button>
                                <button
                                  className="btn-secondary"
                                  type="button"
                                  disabled={patientMemoLoading[id]}
                                  onClick={() => deletePatientMemoEntry(patient.id, memo.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                            <p className="subtle text-sm leading-7">{memo.body}</p>
                            <p className="muted text-xs">Tags: {memo.tags || UNAVAILABLE}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state">
                        <p className="section-title">No patient memos yet</p>
                        <p className="subtle text-sm">Create a follow-up summary, treatment note, or reminder for the next visit.</p>
                      </div>
                    )}
                  </div>
                </article>
              );
            })()}
        </div>

      </section>

    </div>
  );
}
