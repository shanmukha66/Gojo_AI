"use client";

import { useMemo, useState } from "react";

type DocumentListItem = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  status: "uploaded" | "processed" | "failed";
  extractionError: string | null;
  reportDate: string | null;
  createdAt: string;
  updatedAt: string;
};

type DocumentChunk = {
  id: string;
  chunkIndex: number;
  content: string;
};

type LabObservation = {
  id: string;
  testName: string;
  valueText: string | null;
  numericValue: number | null;
  unit: string | null;
  referenceRange: string | null;
  abnormalFlag: string | null;
  observedAt: string | null;
};

type DocumentDetail = DocumentListItem & {
  extractedText: string | null;
  chunks: DocumentChunk[];
  observations: LabObservation[];
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "n/a";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusTone(status: DocumentListItem["status"]) {
  if (status === "processed") return "var(--success)";
  if (status === "failed") return "var(--danger)";
  return "var(--accent-2)";
}

type Props = {
  initialDocuments: DocumentListItem[];
  initialSelectedDocument: DocumentDetail | null;
};

export default function PatientDocuments({ initialDocuments, initialSelectedDocument }: Props) {
  const [documents, setDocuments] = useState<DocumentListItem[]>(initialDocuments);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedDocument?.id ?? initialDocuments[0]?.id ?? null);
  const [selectedDocument, setSelectedDocument] = useState<DocumentDetail | null>(initialSelectedDocument);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [notice, setNotice] = useState("");

  async function loadDocuments(preserveSelected = true) {
    setLoading(true);
    const res = await fetch("/api/patient/documents", { cache: "no-store" });
    const data = (await res.json()) as { documents?: DocumentListItem[]; error?: string };
    if (!res.ok) {
      setNotice(data.error || "Unable to load documents.");
      setLoading(false);
      return;
    }
    const nextDocuments = data.documents || [];
    setDocuments(nextDocuments);
    const nextSelectedId = preserveSelected
      ? selectedId && nextDocuments.some((doc) => doc.id === selectedId)
        ? selectedId
        : nextDocuments[0]?.id ?? null
      : nextDocuments[0]?.id ?? null;
    setSelectedId(nextSelectedId);
    setLoading(false);
  }

  async function loadDocumentDetail(documentId: string) {
    setLoading(true);
    const res = await fetch(`/api/patient/documents/${documentId}`, { cache: "no-store" });
    const data = (await res.json()) as { document?: DocumentDetail; error?: string };
    if (!res.ok || !data.document) {
      setNotice(data.error || "Unable to load document detail.");
      setLoading(false);
      return;
    }
    setSelectedDocument(data.document);
    setLoading(false);
  }

  async function onUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("patient-document-file") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (!file) {
      setNotice("Choose a PDF, PNG, or JPEG report before uploading.");
      return;
    }

    setUploading(true);
    setNotice("");
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/patient/documents/upload", {
      method: "POST",
      body: formData,
    });
    const data = (await res.json()) as { document?: DocumentDetail; error?: string };
    if (!res.ok || !data.document) {
      setNotice(data.error || "Unable to upload document.");
      setUploading(false);
      return;
    }

    form.reset();
    await loadDocuments(false);
    setSelectedId(data.document.id);
    setSelectedDocument(data.document);
    setNotice("Document uploaded and processed.");
    setUploading(false);
  }

  async function onReprocess() {
    if (!selectedId) return;
    setReprocessing(true);
    setNotice("");
    const res = await fetch(`/api/patient/documents/${selectedId}/reprocess`, {
      method: "POST",
    });
    const data = (await res.json()) as { document?: DocumentDetail; error?: string };
    if (!res.ok || !data.document) {
      setNotice(data.error || "Unable to reprocess document.");
      setReprocessing(false);
      return;
    }
    setSelectedDocument(data.document);
    await loadDocuments(true);
    setNotice("Document reprocessed.");
    setReprocessing(false);
  }

  const summary = useMemo(() => {
    const processed = documents.filter((doc) => doc.status === "processed").length;
    const failed = documents.filter((doc) => doc.status === "failed").length;
    return {
      total: documents.length,
      processed,
      failed,
    };
  }, [documents]);

  return (
    <div className="dashboard-grid">
      <section className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Clinical Document Upload</p>
            <p className="subtle text-sm mt-2">
              Upload PDF or image reports, extract readable text, and create chunked retrieval text plus structured lab-style observations.
            </p>
          </div>
          <span className="pill">PDF · PNG · JPG</span>
        </div>

        <div className="summary-grid">
          <div className="summary-tile">
            <p className="summary-tile__label">Documents</p>
            <p className="summary-tile__value">{summary.total}</p>
            <p className="summary-tile__meta">All uploaded reports for this patient account.</p>
          </div>
          <div className="summary-tile">
            <p className="summary-tile__label">Processed</p>
            <p className="summary-tile__value">{summary.processed}</p>
            <p className="summary-tile__meta">Reports with extracted text and generated chunks.</p>
          </div>
          <div className="summary-tile">
            <p className="summary-tile__label">Needs Attention</p>
            <p className="summary-tile__value">{summary.failed}</p>
            <p className="summary-tile__meta">Reports that failed extraction and may need better source quality.</p>
          </div>
        </div>

        <form onSubmit={onUpload} className="surface stack-md">
          <div>
            <label htmlFor="patient-document-file">Upload a report</label>
            <input id="patient-document-file" name="patient-document-file" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" />
          </div>
          <div className="input-shell">
            <button className="btn-primary" type="submit" disabled={uploading}>
              {uploading ? "Uploading..." : "Upload Document"}
            </button>
          </div>
        </form>

        {notice ? (
          <div className={`status-banner ${notice.toLowerCase().includes("unable") || notice.toLowerCase().includes("choose") ? "status-banner--error" : "status-banner--success"}`}>
            <span>{notice}</span>
          </div>
        ) : null}
      </section>

      <section className="dashboard-grid dashboard-grid--split">
        <div className="card-contrast stack-lg">
          <div className="panel-header">
            <div>
              <p className="section-title">Document List</p>
              <p className="subtle text-sm mt-2">Select a report to inspect extraction status, lab observations, and viewer summary.</p>
            </div>
            <span className="pill">Stored Reports</span>
          </div>

          {loading ? (
            <div className="empty-state">
              <p className="section-title">Loading documents</p>
              <p className="subtle text-sm">Fetching uploaded reports for this patient account.</p>
            </div>
          ) : documents.length === 0 ? (
            <div className="empty-state">
              <p className="section-title">No reports uploaded yet</p>
              <p className="subtle text-sm">Upload your first PDF or report image to start building the patient document workspace.</p>
            </div>
          ) : (
            <div className="card-grid">
              {documents.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  className="card stack-md text-left"
                  onClick={async () => {
                    setSelectedId(document.id);
                    await loadDocumentDetail(document.id);
                  }}
                  style={{
                    boxShadow: selectedId === document.id ? "var(--ring-accent)" : undefined,
                    borderColor: selectedId === document.id ? "color-mix(in srgb, var(--accent) 35%, var(--stroke-strong))" : undefined,
                  }}
                >
                  <div className="panel-header">
                    <div>
                      <p className="font-semibold">{document.fileName}</p>
                      <p className="subtle text-sm mt-1">{formatBytes(document.fileSize)} · {document.mimeType}</p>
                    </div>
                    <span className="badge" style={{ background: "color-mix(in srgb, var(--panel-soft) 72%, transparent)", color: statusTone(document.status) }}>
                      {document.status}
                    </span>
                  </div>
                  <div className="list text-sm">
                    <div>• Uploaded: {new Date(document.createdAt).toLocaleString()}</div>
                    <div>• Report date: {document.reportDate || "Unavailable"}</div>
                    {document.extractionError ? <div>• Error: {document.extractionError}</div> : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card-contrast stack-lg">
          <div className="panel-header">
            <div>
              <p className="section-title">Document Viewer Summary</p>
              <p className="subtle text-sm mt-2">This panel summarizes the extracted report, structured observations, and retrieval chunks for the selected document.</p>
            </div>
            {selectedDocument ? (
              <button className="btn-secondary" type="button" onClick={onReprocess} disabled={reprocessing}>
                {reprocessing ? "Reprocessing..." : "Reprocess"}
              </button>
            ) : null}
          </div>

          {!selectedDocument ? (
            <div className="empty-state">
              <p className="section-title">No document selected</p>
              <p className="subtle text-sm">Choose a report from the document list to inspect its extraction summary.</p>
            </div>
          ) : loading ? (
            <div className="empty-state">
              <p className="section-title">Loading document detail</p>
              <p className="subtle text-sm">Pulling extracted text, chunks, and structured observations for the selected report.</p>
            </div>
          ) : (
            <div className="stack-lg">
              <div className="summary-grid">
                <div className="summary-tile">
                  <p className="summary-tile__label">Status</p>
                  <p className="summary-tile__value text-[1.1rem]">{selectedDocument.status}</p>
                  <p className="summary-tile__meta">{selectedDocument.extractionError || "Extraction completed or is ready for review."}</p>
                </div>
                <div className="summary-tile">
                  <p className="summary-tile__label">Observations</p>
                  <p className="summary-tile__value">{selectedDocument.observations.length}</p>
                  <p className="summary-tile__meta">Structured test rows extracted from the document text.</p>
                </div>
                <div className="summary-tile">
                  <p className="summary-tile__label">Chunks</p>
                  <p className="summary-tile__value">{selectedDocument.chunks.length}</p>
                  <p className="summary-tile__meta">Chunked retrieval blocks stored for downstream question answering.</p>
                </div>
              </div>

              <div className="surface stack-md">
                <div>
                  <p className="eyebrow">Structured Extraction</p>
                  <p className="text-lg font-semibold mt-2">Observed tests and values</p>
                </div>
                {selectedDocument.observations.length === 0 ? (
                  <p className="subtle text-sm">No structured lab-style rows were detected in this document yet.</p>
                ) : (
                  <div className="card-grid">
                    {selectedDocument.observations.slice(0, 10).map((observation) => (
                      <div key={observation.id} className="card">
                        <p className="font-semibold">{observation.testName}</p>
                        <p className="subtle text-sm mt-2">
                          Value: {observation.valueText || "Unavailable"}
                          {observation.unit ? ` ${observation.unit}` : ""}
                        </p>
                        <p className="subtle text-sm mt-1">Reference: {observation.referenceRange || "Unavailable"}</p>
                        <p className="subtle text-sm mt-1">Flag: {observation.abnormalFlag || "Unavailable"}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="surface stack-md">
                <div>
                  <p className="eyebrow">Extraction Text</p>
                  <p className="text-lg font-semibold mt-2">Viewer summary</p>
                </div>
                <p className="subtle text-sm leading-7 whitespace-pre-wrap">
                  {selectedDocument.extractedText?.slice(0, 2400) || "Unavailable"}
                </p>
              </div>

              <div className="surface stack-md">
                <div>
                  <p className="eyebrow">Retrieval Chunks</p>
                  <p className="text-lg font-semibold mt-2">Chunked text for downstream retrieval</p>
                </div>
                {selectedDocument.chunks.length === 0 ? (
                  <p className="subtle text-sm">No chunks available for this report yet.</p>
                ) : (
                  <div className="card-grid">
                    {selectedDocument.chunks.slice(0, 4).map((chunk) => (
                      <div key={chunk.id} className="card">
                        <p className="eyebrow">Chunk {chunk.chunkIndex + 1}</p>
                        <p className="subtle text-sm mt-2 leading-7 whitespace-pre-wrap">{chunk.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
