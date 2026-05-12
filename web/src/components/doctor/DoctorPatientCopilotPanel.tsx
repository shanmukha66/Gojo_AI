"use client";

import { useState } from "react";

type GraphPath = {
  title: string;
  description: string;
  path: string[];
  sourceCategory: string;
};

type CopilotAnswer = {
  answer: string;
  evidenceSource?: string;
  evidence?: string[];
  caution?: string;
  escalation?: string;
  source_mode?: string;
  model?: string;
  fallback?: boolean;
  timestamp?: string;
  sourceDetails?: string[];
  graphPaths?: GraphPath[];
  provenance?: {
    evidenceReferences: string[];
    model: string;
    mode: string;
  };
};

type DecisionReport = {
  title: string;
  summary: string;
  evidenceUsed: string[];
  actionItems: string[];
  cautionPoints: string[];
  clinicianNote: string;
  provenance?: {
    evidenceReferences: string[];
    model: string;
    mode: string;
  };
};

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || "Unexpected response" };
  }
}

export default function DoctorPatientCopilotPanel({ patientId }: { patientId: string }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [answer, setAnswer] = useState<CopilotAnswer | null>(null);
  const [report, setReport] = useState<DecisionReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function askCopilot() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    const res = await fetch('/api/doctor/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId, query: query.trim() }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || 'Unable to get copilot answer');
    } else {
      setAnswer(data);
    }
    setLoading(false);
  }

  async function generateReport() {
    setReportLoading(true);
    setError(null);
    const res = await fetch(`/api/doctor/report/${patientId}/generate`, { method: 'POST' });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || 'Unable to generate report');
    } else {
      setReport(data.report);
    }
    setReportLoading(false);
  }

  return (
    <div className="stack-lg">
      <section className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Doctor Copilot</p>
            <p className="subtle text-sm mt-2">Ask focused chart questions without mixing the copilot into the reports and memo pages.</p>
          </div>
          <span className="pill">Patient evidence only</span>
        </div>
        {error ? (
          <div className="status-banner status-banner--error">
            <strong>Issue</strong>
            <span>{error}</span>
          </div>
        ) : null}
        <div className="surface stack-md form-shell">
          <input placeholder="Ask about the timeline, reports, findings, or review history" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="input-shell compact-actions compact-actions--wrap">
            <button className="btn-primary btn-fit" type="button" disabled={loading} onClick={askCopilot}>
              {loading ? 'Answering...' : 'Ask copilot'}
            </button>
            <button className="btn-secondary btn-fit" type="button" disabled={reportLoading} onClick={generateReport}>
              {reportLoading ? 'Generating...' : 'Generate decision report'}
            </button>
          </div>
        </div>
      </section>

      {answer ? (
        <section className="card-contrast stack-md">
          <div className="panel-header">
            <div>
              <p className="section-title">Copilot Answer</p>
              <p className="subtle text-sm mt-2">{answer.evidenceSource || answer.source_mode || 'Evidence-grounded response'}</p>
            </div>
            <span className="pill">{answer.fallback ? 'Fallback' : answer.source_mode || 'GPT'}</span>
          </div>
          <p className="subtle text-sm leading-7">{answer.answer}</p>
          {(answer.evidence || answer.sourceDetails || []).length > 0 ? (
            <div className="list text-sm">
              {(answer.evidence || answer.sourceDetails || []).map((item, index) => (
                <div key={`answer-evidence-${index}`}>• {item}</div>
              ))}
            </div>
          ) : null}
          {answer.graphPaths?.length ? (
            <div className="stack-sm text-sm">
              <p className="font-semibold">Graph paths</p>
              <div className="list">
                {answer.graphPaths.slice(0, 4).map((path, index) => (
                  <div key={`graph-path-${index}`}>• {path.path.join(' -> ')} · {path.description}</div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {report ? (
        <section className="card-contrast stack-md">
          <div className="panel-header">
            <div>
              <p className="section-title">Decision Report</p>
              <p className="subtle text-sm mt-2">{report.title}</p>
            </div>
            <span className="pill">Structured output</span>
          </div>
          <p className="subtle text-sm leading-7">{report.summary}</p>
          <div className="stack-sm text-sm">
            <p className="font-semibold">Evidence used</p>
            <div className="list">
              {report.evidenceUsed.map((item, index) => <div key={`report-evidence-${index}`}>• {item}</div>)}
            </div>
          </div>
          <div className="stack-sm text-sm">
            <p className="font-semibold">Action items</p>
            <div className="list">
              {report.actionItems.map((item, index) => <div key={`report-action-${index}`}>• {item}</div>)}
            </div>
          </div>
          <div className="stack-sm text-sm">
            <p className="font-semibold">Caution points</p>
            <div className="list">
              {report.cautionPoints.map((item, index) => <div key={`report-caution-${index}`}>• {item}</div>)}
            </div>
          </div>
          <p className="subtle text-sm">{report.clinicianNote}</p>
        </section>
      ) : null}
    </div>
  );
}
