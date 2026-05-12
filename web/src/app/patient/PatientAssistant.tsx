"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AssistantMode = "report" | "firstaid" | "booking";

type PatientDocumentOption = {
  id: string;
  fileName: string;
  reportDate: string | null;
};

type AssistantResponse = {
  mode: AssistantMode;
  answer: string;
  evidenceSource: string;
  cautionLevel: "low" | "moderate" | "high";
  escalationNote: string;
  fallback: boolean;
  sourceDetails?: string[];
};

type ChatMessage = {
  id: string;
  role: "patient" | "assistant";
  text: string;
  fileName?: string;
  result?: AssistantResponse;
};

type SavedChat = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
};

type Props = {
  initialDocuments: PatientDocumentOption[];
};

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognition;
    SpeechRecognition?: new () => SpeechRecognition;
  }

  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
  }

  interface SpeechRecognitionEvent {
    results: {
      [index: number]: {
        [index: number]: { transcript: string };
        isFinal: boolean;
        readonly length: number;
      };
      readonly length: number;
    };
  }

  interface SpeechRecognitionErrorEvent {
    error: string;
  }
}

const STORAGE_KEY = "gojo-patient-assistant-chats-v1";

const modeMeta: Record<AssistantMode, { title: string; short: string; placeholder: string; action: string }> = {
  report: {
    title: "Ask about my report",
    short: "Reports",
    placeholder: "Ask about a blood test, report value, flagged result, or uploaded document",
    action: "Ask Report",
  },
  firstaid: {
    title: "Ask basic first aid",
    short: "First Aid",
    placeholder: "Ask about fever, cuts, burns, sore throat, headache, or basic first-aid steps",
    action: "Ask First Aid",
  },
  booking: {
    title: "Book appointment",
    short: "Booking",
    placeholder: "Describe why you want to book an appointment",
    action: "Prepare Booking",
  },
};

const quickPrompts: Array<{ text: string; mode: AssistantMode }> = [
  { text: "Can you explain my latest blood report in simple words?", mode: "report" },
  { text: "What values in this report look important to ask my doctor about?", mode: "report" },
  { text: "I have fever and body pain. What basic first aid should I follow?", mode: "firstaid" },
];

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || "Unexpected response" };
  }
}

function makeChatTitle(messages: ChatMessage[]) {
  const first = messages.find((message) => message.role === "patient")?.text || "New patient chat";
  return first.length > 48 ? `${first.slice(0, 48)}...` : first;
}

function speechErrorMessage(code: string) {
  if (code === "not-allowed") return "Microphone permission is blocked. Allow microphone access in browser/site settings, then try again.";
  if (code === "network") return "Microphone permission is allowed, but the browser speech service could not connect. You can still type normally.";
  if (code === "no-speech") return "No speech was detected. Try again and speak after the listening state starts.";
  if (code === "audio-capture") return "No working microphone was detected. Check the system input device.";
  return `Voice input error: ${code}`;
}

function inferMode(currentMode: AssistantMode, text: string, hasFile: boolean): AssistantMode {
  if (hasFile) return "report";
  const normalized = text.toLowerCase();
  const firstAidWords = [
    "fever",
    "pain",
    "burn",
    "cut",
    "bleeding",
    "cough",
    "cold",
    "headache",
    "migraine",
    "migraines",
    "nausea",
    "vomit",
    "vomiting",
    "dizzy",
    "dizziness",
    "sore throat",
    "body pain",
    "stomach",
    "rash",
    "first aid",
    "what to do",
  ];
  const bookingWords = ["appointment", "book", "schedule", "visit", "doctor", "clinic"];
  const reportWords = ["report", "blood", "lab", "test", "hba1c", "glucose", "scan", "x-ray", "pdf"];
  if (firstAidWords.some((word) => normalized.includes(word)) && !bookingWords.some((word) => normalized.includes(word))) return "firstaid";
  if (reportWords.some((word) => normalized.includes(word))) return "report";
  return currentMode;
}

export default function PatientAssistant({ initialDocuments }: Props) {
  const [mode, setMode] = useState<AssistantMode>("report");
  const [documents, setDocuments] = useState<PatientDocumentOption[]>(initialDocuments);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>(initialDocuments[0]?.id ?? "");
  const [documentSearch, setDocumentSearch] = useState("");
  const [query, setQuery] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);
  const [activeChatId, setActiveChatId] = useState(uid());
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const filteredDocuments = useMemo(() => {
    const term = documentSearch.trim().toLowerCase();
    if (!term) return documents;
    return documents.filter((document) => document.fileName.toLowerCase().includes(term));
  }, [documentSearch, documents]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setSavedChats(JSON.parse(stored) as SavedChat[]);
    } catch {
      setSavedChats([]);
    }
  }, []);

  useEffect(() => {
    if (!messages.length) return;
    const nextChat: SavedChat = {
      id: activeChatId,
      title: makeChatTitle(messages),
      messages,
      updatedAt: new Date().toISOString(),
    };
    setSavedChats((current) => {
      const next = [nextChat, ...current.filter((chat) => chat.id !== activeChatId)].slice(0, 12);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Recent patient chats are a local convenience cache only.
      }
      return next;
    });
  }, [activeChatId, messages]);

  function clearFile() {
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function startNewChat() {
    setActiveChatId(uid());
    setMessages([]);
    setQuery("");
    clearFile();
    setNotice("");
  }

  function openSavedChat(chat: SavedChat) {
    setActiveChatId(chat.id);
    setMessages(chat.messages);
    setQuery("");
    clearFile();
    setNotice("");
  }

  function deleteSavedChat(chatId: string) {
    setSavedChats((current) => {
      const next = current.filter((chat) => chat.id !== chatId);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage failures.
      }
      return next;
    });
    if (chatId === activeChatId) startNewChat();
  }

  async function refreshDocuments(preferredId?: string) {
    const res = await fetch("/api/patient/documents", { cache: "no-store" });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || "Unable to refresh documents");
    const nextDocs = (data.documents || []) as PatientDocumentOption[];
    setDocuments(nextDocs);
    if (preferredId) setSelectedDocumentId(preferredId);
    else if (!selectedDocumentId && nextDocs[0]) setSelectedDocumentId(nextDocs[0].id);
    return nextDocs;
  }

  async function uploadSelectedFile() {
    if (!file) return selectedDocumentId;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/patient/documents/upload", { method: "POST", body: form });
    const data = await safeJson(res);
    if (!res.ok || !data.document) throw new Error(data.error || "Unable to upload document");
    await refreshDocuments(data.document.id);
    clearFile();
    return String(data.document.id);
  }

  function stopListening() {
    if (recognitionRef.current) recognitionRef.current.stop();
    setListening(false);
  }

  function startVoiceInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setNotice("Browser speech-to-text is not available here. You can still type normally.");
      return;
    }
    if (recognitionRef.current) recognitionRef.current.stop();
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length })
        .map((_, index) => event.results[index]?.[0]?.transcript || "")
        .join(" ")
        .trim();
      if (transcript) setQuery((prev) => `${prev} ${transcript}`.trim());
    };
    recognition.onerror = (event) => {
      setNotice(speechErrorMessage(event.error || "unknown"));
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    setNotice("");
    recognition.start();
  }

  async function askPatientAssistant(event?: React.FormEvent) {
    event?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed && !file) {
      setNotice("Type a question, dictate one, or attach a report first.");
      return;
    }

    const effectiveMode = inferMode(mode, trimmed, Boolean(file));
    if (effectiveMode !== mode) {
      setMode(effectiveMode);
      setNotice(`Routed this question to ${modeMeta[effectiveMode].short} because it matches that workflow better.`);
    } else {
      setNotice("");
    }

    setLoading(true);
    const text = trimmed || `Uploaded ${file?.name || "a document"} for review.`;
    setMessages((prev) => [...prev, { id: uid(), role: "patient", text, fileName: file?.name }]);
    setQuery("");

    try {
      const documentId = await uploadSelectedFile();
      if (!trimmed) {
        setNotice("Document uploaded. Ask a question about it once processing is complete.");
        setLoading(false);
        return;
      }

      const route = effectiveMode === "report" ? "/api/patient/ask-docs" : "/api/patient/chat";
      const res = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          mode: effectiveMode,
          documentId: effectiveMode === "report" ? documentId || undefined : undefined,
        }),
      });
      const data = (await safeJson(res)) as AssistantResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || "Unable to reach the patient assistant.");

      setMessages((prev) => [...prev, { id: uid(), role: "assistant", text: data.answer, result: data }]);
      if (data.fallback) setNotice("Fallback response path was used because grounded evidence was limited.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to reach the patient assistant service.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="copilot-chat-shell patient-chat-shell">
      <aside className="copilot-chat-sidebar">
        <button className="copilot-sidebar-action" type="button" onClick={startNewChat}>
          + New chat
        </button>

        <div className="copilot-sidebar-section">
          <p className="eyebrow">Recent chats</p>
          {savedChats.length ? (
            savedChats.map((chat) => (
              <div key={chat.id} className={`copilot-saved-chat ${chat.id === activeChatId ? "copilot-saved-chat--active" : ""}`}>
                <button type="button" onClick={() => openSavedChat(chat)}>
                  <span>{chat.title}</span>
                  <small>{new Date(chat.updatedAt).toLocaleDateString()}</small>
                </button>
                <button className="copilot-saved-chat__delete" type="button" onClick={() => deleteSavedChat(chat.id)} title="Delete chat">
                  x
                </button>
              </div>
            ))
          ) : (
            <p className="subtle text-sm">Patient chats save here automatically.</p>
          )}
        </div>

        <div className="copilot-sidebar-section">
          <p className="eyebrow">Quick starts</p>
          {quickPrompts.map((prompt) => (
            <button
              key={prompt.text}
              className="copilot-history-item"
              type="button"
              onClick={() => {
                setMode(prompt.mode);
                setQuery(prompt.text);
              }}
            >
              {prompt.text}
            </button>
          ))}
        </div>

        <div className="copilot-sidebar-section">
          <p className="eyebrow">Search reports</p>
          <input placeholder="Search uploaded documents" value={documentSearch} onChange={(event) => setDocumentSearch(event.target.value)} />
          <div className="patient-doc-list">
            {filteredDocuments.length ? (
              filteredDocuments.slice(0, 8).map((document) => (
                <button
                  key={document.id}
                  type="button"
                  className={`patient-doc-row ${document.id === selectedDocumentId ? "patient-doc-row--active" : ""}`}
                  onClick={() => {
                    setSelectedDocumentId(document.id);
                    setMode("report");
                  }}
                >
                  <span>{document.fileName}</span>
                  <small>{document.reportDate || "Uploaded report"}</small>
                </button>
              ))
            ) : (
              <p className="subtle text-sm">No matching reports yet.</p>
            )}
          </div>
        </div>
      </aside>

      <main className="copilot-chat-main">
        <div className="copilot-chat-topbar">
          <div>
            <p className="font-semibold">Patient Assistant</p>
            <p className="muted text-xs">Chat, upload reports, search documents, and ask safely</p>
          </div>
          <span className="pill">{modeMeta[mode].short}</span>
        </div>

        <div className="patient-mode-tabs">
          {Object.entries(modeMeta).map(([key, item]) => (
            <button key={key} type="button" className={mode === key ? "patient-mode-tabs__active" : ""} onClick={() => setMode(key as AssistantMode)}>
              {item.short}
            </button>
          ))}
        </div>

        <div className="copilot-thread">
          {messages.length === 0 ? (
            <div className="copilot-empty">
              <p className="section-title">Ask about reports or symptoms</p>
              <p className="subtle text-sm">Upload a PDF/image report, search existing documents, use voice, or type a simple question.</p>
            </div>
          ) : (
            messages.map((message) => (
              <article key={message.id} className={`copilot-message copilot-message--${message.role === "patient" ? "doctor" : "copilot"}`}>
                <div className="copilot-message__bubble">
                  {message.fileName ? <p className="muted text-xs">Attached: {message.fileName}</p> : null}
                  <p>{message.text}</p>
                  {message.result ? (
                    <div className="patient-answer-details">
                      <div className="copilot-result-meta">
                        <span>{message.result.evidenceSource}</span>
                        <span>Caution: {message.result.cautionLevel}</span>
                        <span>{message.result.fallback ? "Fallback" : "Grounded"}</span>
                      </div>
                      <p className="muted text-xs mt-2">{message.result.escalationNote}</p>
                    </div>
                  ) : null}
                </div>
              </article>
            ))
          )}
          {loading ? (
            <article className="copilot-message copilot-message--copilot">
              <div className="copilot-message__bubble copilot-thinking">Thinking...</div>
            </article>
          ) : null}
        </div>

        {notice ? <div className={`copilot-inline-error ${notice.toLowerCase().includes("uploaded") ? "copilot-inline-note" : ""}`}>{notice}</div> : null}

        <form className="copilot-composer" onSubmit={askPatientAssistant}>
          {file ? (
            <div className="copilot-attachment copilot-attachment--inline">
              <span>Attached: {file.name}</span>
              <button type="button" onClick={clearFile}>Remove</button>
            </div>
          ) : null}
          {mode === "report" && documents.length ? (
            <select value={selectedDocumentId} onChange={(event) => setSelectedDocumentId(event.target.value)}>
              <option value="">Search all uploaded reports</option>
              {documents.map((document) => (
                <option key={document.id} value={document.id}>{document.fileName}</option>
              ))}
            </select>
          ) : null}
          <textarea
            rows={2}
            placeholder={modeMeta[mode].placeholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void askPatientAssistant();
              }
            }}
          />
          <div className="copilot-composer-actions">
            <input
              ref={fileRef}
              className="hidden"
              type="file"
              accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,application/pdf,text/plain,text/csv,image/png,image/jpeg"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setMode("report");
              }}
            />
            <button className="copilot-icon-button" type="button" title="Upload report" onClick={() => fileRef.current?.click()}>
              +
            </button>
            <button className="copilot-icon-button" type="button" title="Dictate" onClick={listening ? stopListening : startVoiceInput}>
              {listening ? "■" : "🎙"}
            </button>
            <button className="copilot-send-button" type="submit" disabled={loading} title={modeMeta[mode].action}>
              ↑
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
