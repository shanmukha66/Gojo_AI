"use client";

import { useEffect, useRef, useState } from "react";

type DoctorMemo = {
  id: string;
  doctorId: string;
  title: string;
  body: string;
  type: string;
  tags: string | null;
  createdAt: string;
  updatedAt: string;
};

type PersonalMemoEditor = {
  title: string;
  body: string;
  type: string;
  tags: string;
};

const UNAVAILABLE = "Unavailable";

function speechErrorMessage(code: string) {
  if (code === "not-allowed") {
    return "Microphone permission is blocked. Allow microphone access in the browser/site settings, then click Dictate note again. You can still type normally.";
  }
  if (code === "network") {
    return "Microphone permission is allowed, but Chrome's speech-to-text service could not connect. This browser dictation uses an online speech service, so check internet/VPN/firewall, then reload and try again. You can still type the memo normally.";
  }
  if (code === "no-speech") {
    return "No speech was detected. Click Dictate note again and speak clearly after the browser starts listening.";
  }
  if (code === "audio-capture") {
    return "No working microphone was detected. Check your system input device, then try Dictate note again.";
  }
  return `Speech capture failed: ${code}`;
}

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || "Unexpected response" };
  }
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

export default function DoctorMemosBoard() {
  const recognitionRef = useRef<unknown>(null);
  const [memos, setMemos] = useState<DoctorMemo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);
  const [editor, setEditor] = useState<PersonalMemoEditor>({
    title: "",
    body: "",
    type: "general",
    tags: "",
  });

  async function loadMemos() {
    setLoading(true);
    const res = await fetch("/api/doctor/memos", { cache: "no-store" });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Failed to load personal memos");
      setMemos([]);
    } else {
      setError(null);
      setMemos(data.memos || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setLoading(true);
      const res = await fetch("/api/doctor/memos", { cache: "no-store" });
      const data = await safeJson(res);
      if (cancelled) return;
      if (!res.ok) {
        setError(data.error || "Failed to load personal memos");
        setMemos([]);
      } else {
        setError(null);
        setMemos(data.memos || []);
      }
      setLoading(false);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveMemo() {
    const title = editor.title.trim();
    const body = editor.body.trim();
    if (!title || !body) {
      setError("Memo title and body are required");
      return;
    }

    setLoading(true);
    const res = await fetch(editingMemoId ? `/api/doctor/memos/${editingMemoId}` : "/api/doctor/memos", {
      method: editingMemoId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        body,
        type: editor.type,
        tags: editor.tags.trim() || null,
      }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Failed to save personal memo");
      setLoading(false);
      return;
    }

    setEditor({ title: "", body: "", type: "general", tags: "" });
    setEditingMemoId(null);
    await loadMemos();
    setLoading(false);
  }

  async function deleteMemo(id: string) {
    setLoading(true);
    const res = await fetch(`/api/doctor/memos/${id}`, { method: "DELETE" });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Failed to delete personal memo");
      setLoading(false);
      return;
    }
    if (editingMemoId === id) {
      setEditor({ title: "", body: "", type: "general", tags: "" });
      setEditingMemoId(null);
    }
    await loadMemos();
    setLoading(false);
  }

  function startDictation() {
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
      setError("Speech-to-text is unavailable in this browser. You can still type the memo normally.");
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
      setEditor((prev) => ({
        ...prev,
        body: `${prev.body} ${transcript}`.trim(),
      }));
    };
    recognition.onerror = (event) => {
      const code = event.error || "unknown";
      setError(speechErrorMessage(code));
      setDictating(false);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setDictating(false);
    };
    recognitionRef.current = recognition;
    setDictating(true);
    recognition.start();
  }

  return (
    <section className="card-contrast stack-lg fade-up" style={{ animationDelay: "120ms" }}>
      <div className="panel-header">
        <div>
          <p className="section-title">Doctor Memo Panel</p>
          <p className="subtle text-sm mt-2">
            Keep personal notes, reminders, and quick planning thoughts here so the clinical workspace stays focused on patients.
          </p>
        </div>
        <span className="pill">Private Notes</span>
      </div>

      {error ? (
        <div className="status-banner status-banner--error">
          <strong>Issue</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="dashboard-grid dashboard-grid--split">
        <div className="surface stack-md">
          <div>
            <p className="eyebrow">Create memo</p>
            <p className="text-lg font-semibold mt-2">Personal memo editor</p>
          </div>
          <input
            placeholder="Memo title"
            value={editor.title}
            onChange={(event) => setEditor((prev) => ({ ...prev, title: event.target.value }))}
          />
          <div className="input-shell">
            <select
              value={editor.type}
              onChange={(event) => setEditor((prev) => ({ ...prev, type: event.target.value }))}
            >
              <option value="general">General</option>
              <option value="planning">Planning</option>
              <option value="reminder">Reminder</option>
              <option value="daily">Daily task</option>
            </select>
            <input
              placeholder="Tags (comma separated)"
              value={editor.tags}
              onChange={(event) => setEditor((prev) => ({ ...prev, tags: event.target.value }))}
            />
          </div>
          <textarea
            placeholder="Write or dictate a private doctor memo"
            value={editor.body}
            onChange={(event) => setEditor((prev) => ({ ...prev, body: event.target.value }))}
            rows={7}
          />
          <div className="input-shell">
            <button className="btn-secondary" type="button" onClick={startDictation}>
              {dictating ? "Listening..." : "Dictate note"}
            </button>
            <button className="btn-primary" type="button" onClick={saveMemo} disabled={loading}>
              {loading ? "Saving..." : editingMemoId ? "Update personal memo" : "Save personal memo"}
            </button>
          </div>
        </div>

        <div className="surface stack-md">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Recent memos</p>
              <p className="text-lg font-semibold mt-2">Personal memo list</p>
            </div>
            <span className="pill">{memos.length} notes</span>
          </div>
          {loading && memos.length === 0 ? (
            <div className="empty-state">
              <p className="section-title">Loading memos</p>
              <p className="subtle text-sm">Fetching your private notes.</p>
            </div>
          ) : memos.length === 0 ? (
            <div className="empty-state">
              <p className="section-title">No personal memos yet</p>
              <p className="subtle text-sm">Create your first private note or dictate one with the microphone.</p>
            </div>
          ) : (
            <div className="stack-md">
              {memos.map((memo) => (
                <div key={memo.id} className="card stack-sm">
                  <div className="panel-header">
                    <div>
                      <p className="font-semibold">{memo.title}</p>
                      <p className="subtle text-xs mt-1">
                        {memo.type} · Updated {formatDate(memo.updatedAt)}
                      </p>
                    </div>
                    <button
                      className="btn-secondary"
                      type="button"
                      onClick={() => {
                        setEditor({
                          title: memo.title,
                          body: memo.body,
                          type: memo.type,
                          tags: memo.tags || "",
                        });
                        setEditingMemoId(memo.id);
                      }}
                    >
                      Edit draft
                    </button>
                  </div>
                  <p className="subtle text-sm leading-7">{memo.body}</p>
                  <p className="muted text-xs">Tags: {memo.tags || UNAVAILABLE}</p>
                  <div className="input-shell">
                    <button className="btn-secondary" type="button" onClick={() => deleteMemo(memo.id)} disabled={loading}>
                      Delete memo
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
