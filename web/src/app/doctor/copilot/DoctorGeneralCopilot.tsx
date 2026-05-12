"use client";

import { useEffect, useRef, useState } from "react";

type CopilotResult = {
  answer: string;
  evidence: string[];
  caution: "low" | "moderate" | "high";
  escalation: string;
  source_mode: string;
  model: string;
  fallback: boolean;
  timestamp: string;
  imageWarning?: string;
  imageAnalysis?: {
    visualSummary: string;
    possibleConcerns: string[];
    visibleText: string[];
    suggestedDoctorQuestions: string[];
    caution: "low" | "moderate" | "high";
    escalation: string;
  } | null;
  sources: Array<{ title: string; topic: string; type: string; content: string }>;
};

type ChatMessage = {
  id: string;
  role: "doctor" | "copilot";
  text: string;
  result?: CopilotResult;
  fileName?: string;
};

type SavedChat = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
};

const STORAGE_KEY = "gojo-doctor-copilot-chats-v1";

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || "Unexpected response" };
  }
}

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const starterPrompts = [
  "What should I verify before adjusting diabetes medication in CKD?",
  "Summarize possible red flags from this blood report.",
  "What follow-up questions should I ask before the next visit?",
];

function makeChatTitle(messages: ChatMessage[]) {
  const firstDoctorMessage = messages.find((message) => message.role === "doctor")?.text || "New copilot chat";
  return firstDoctorMessage.length > 48 ? `${firstDoctorMessage.slice(0, 48)}...` : firstDoctorMessage;
}

export default function DoctorGeneralCopilot() {
  const [question, setQuestion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [answerMode, setAnswerMode] = useState("balanced");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);
  const [activeChatId, setActiveChatId] = useState(uid());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/doctor/copilot/chats")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (alive && Array.isArray(data?.chats)) {
          setSavedChats(data.chats as SavedChat[]);
          try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data.chats));
          } catch {
            // Backend is the source of truth; local storage is only a fast cache.
          }
        }
      })
      .catch(() => {
        // If the backend request fails, keep the local convenience cache below.
      });
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setSavedChats(JSON.parse(stored) as SavedChat[]);
    } catch {
      setSavedChats([]);
    }
    return () => {
      alive = false;
    };
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
      const withoutCurrent = current.filter((chat) => chat.id !== activeChatId);
      const next = [nextChat, ...withoutCurrent].slice(0, 12);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Local storage is only a convenience cache for recent copilot chats.
      }
      fetch("/api/doctor/copilot/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextChat),
      }).catch(() => {
        // The UI should not block while the backend CSV/XLSX snapshot is written.
      });
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
    setQuestion("");
    clearFile();
    setError("");
  }

  function openSavedChat(chat: SavedChat) {
    setActiveChatId(chat.id);
    setMessages(chat.messages);
    setQuestion("");
    clearFile();
    setError("");
  }

  function deleteSavedChat(chatId: string) {
    setSavedChats((current) => {
      const next = current.filter((chat) => chat.id !== chatId);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage write failures.
      }
      return next;
    });
    fetch(`/api/doctor/copilot/chats?id=${encodeURIComponent(chatId)}`, { method: "DELETE" }).catch(() => {
      // Keep UI responsive even if export cleanup fails.
    });
    if (chatId === activeChatId) startNewChat();
  }

  function startVoiceInput() {
    const Recognition = typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
    if (!Recognition) {
      setError("Speech-to-text is unavailable in this browser. You can still type normally.");
      return;
    }
    if (recognitionRef.current?.stop) recognitionRef.current.stop();
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results || [])
        .map((result: any) => result?.[0]?.transcript || "")
        .join(" ")
        .trim();
      if (transcript) setQuestion((prev) => `${prev} ${transcript}`.trim());
    };
    recognition.onerror = (event: any) => {
      const code = event?.error || "unknown";
      setError(code === "not-allowed" ? "Microphone permission is blocked. Allow microphone access in browser/site settings." : `Speech capture failed: ${code}`);
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setError("");
    setListening(true);
    recognition.start();
  }

  function stopVoiceInput() {
    if (recognitionRef.current?.stop) recognitionRef.current.stop();
    setListening(false);
  }

  async function askCopilot(event?: React.FormEvent) {
    event?.preventDefault();
    const text = question.trim();
    if (!text) {
      setError("Ask a doctor question first.");
      return;
    }

    const doctorMessage: ChatMessage = { id: uid(), role: "doctor", text, fileName: file?.name };
    setMessages((prev) => [...prev, doctorMessage]);
    setQuestion("");
    setError("");
    setLoading(true);

    const form = new FormData();
    form.set("question", text);
    form.set("answerMode", answerMode);
    if (file) form.set("file", file);

    const res = await fetch("/api/doctor/second-opinion", { method: "POST", body: form });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Unable to run doctor copilot.");
    } else {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "copilot",
          text: data.answer,
          result: data,
        },
      ]);
    }
    setFile(null);
    clearFile();
    setLoading(false);
  }

  async function sendFeedback(message: ChatMessage, rating: "useful" | "too_vague" | "unsafe" | "missing_evidence" | "too_short") {
    await fetch("/api/ai/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeKind: "doctor_general_second_opinion",
        chatId: activeChatId,
        messageId: message.id,
        rating,
        answerText: message.text,
      }),
    }).catch(() => null);
    setError(rating === "useful" ? "Feedback saved: useful answer." : "Feedback saved. RL metrics will use this signal.");
  }

  return (
    <div className="copilot-chat-shell">
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
                <button className="copilot-saved-chat__delete" type="button" title="Delete saved chat" onClick={() => deleteSavedChat(chat.id)}>
                  x
                </button>
              </div>
            ))
          ) : (
            <p className="subtle text-sm">Chats save here automatically after you ask.</p>
          )}
        </div>
        <div className="copilot-sidebar-section">
          <p className="eyebrow">Quick starts</p>
          {starterPrompts.map((prompt) => (
            <button key={prompt} className="copilot-history-item" type="button" onClick={() => setQuestion(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
        <div className="copilot-sidebar-section">
          <p className="eyebrow">Ground truth</p>
          <p className="subtle text-sm">MiniMax uses local medical snippets, uploaded text/PDF context, cache, and RL metrics.</p>
        </div>
      </aside>

      <main className="copilot-chat-main">
        <div className="copilot-chat-topbar">
          <div>
            <p className="font-semibold">Doctor Copilot</p>
            <p className="muted text-xs">General second opinion workspace</p>
          </div>
          <div className="app-header__cluster">
            <select className="form-input form-input--compact" value={answerMode} onChange={(event) => setAnswerMode(event.target.value)}>
              <option value="quick">Quick</option>
              <option value="balanced">Balanced</option>
              <option value="checklist">Checklist</option>
              <option value="patient_friendly">Patient-friendly</option>
              <option value="next_steps">Next steps</option>
            </select>
            <span className="pill">MiniMax text path</span>
          </div>
        </div>

        <div className="copilot-thread">
          {messages.length === 0 ? (
            <div className="copilot-empty">
              <p className="section-title">Ask a clinical doubt</p>
              <p className="subtle text-sm">Type, dictate, or attach a PDF/text/blood report. Image diagnosis is not enabled yet.</p>
            </div>
          ) : (
            messages.map((message) => (
              <article key={message.id} className={`copilot-message copilot-message--${message.role}`}>
                <div className="copilot-message__bubble">
                  {message.fileName ? <p className="muted text-xs">Attached: {message.fileName}</p> : null}
                  <p>{message.text}</p>
                  {message.result?.imageAnalysis ? (
                    <div className="copilot-image-analysis">
                      <p className="eyebrow">Image assist</p>
                      <p>{message.result.imageAnalysis.visualSummary}</p>
                      {message.result.imageAnalysis.possibleConcerns.length ? (
                        <div>
                          <p className="font-semibold text-sm">Possible visible concerns</p>
                          <ul>
                            {message.result.imageAnalysis.possibleConcerns.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {message.result.imageAnalysis.suggestedDoctorQuestions.length ? (
                        <div>
                          <p className="font-semibold text-sm">What to verify next</p>
                          <ul>
                            {message.result.imageAnalysis.suggestedDoctorQuestions.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <p className="muted text-xs">{message.result.imageAnalysis.escalation}</p>
                    </div>
                  ) : null}
                  {message.result ? (
                    <div className="stack-sm">
                      <div className="copilot-result-meta">
                        <span>{message.result.fallback ? "Fallback" : message.result.model}</span>
                        <span>Caution: {message.result.caution}</span>
                        <span>{message.result.sources.length} sources</span>
                        <span>{message.result.source_mode}</span>
                      </div>
                      {message.role === "copilot" ? (
                        <div className="copilot-feedback-row">
                          <button type="button" onClick={() => sendFeedback(message, "useful")}>Useful</button>
                          <button type="button" onClick={() => sendFeedback(message, "too_vague")}>Too vague</button>
                          <button type="button" onClick={() => sendFeedback(message, "too_short")}>Too short</button>
                          <button type="button" onClick={() => sendFeedback(message, "missing_evidence")}>Missing evidence</button>
                          <button type="button" onClick={() => sendFeedback(message, "unsafe")}>Unsafe</button>
                        </div>
                      ) : null}
                      {message.result.sources.length ? (
                        <details className="copilot-source-details">
                          <summary>Sources used</summary>
                          <ul>
                            {message.result.sources.slice(0, 5).map((source, index) => (
                              <li key={`${source.title}-${index}`}>
                                <strong>{source.title}</strong>: {source.content.slice(0, 180)}{source.content.length > 180 ? "..." : ""}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
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

        {error ? <div className="copilot-inline-error">{error}</div> : null}

        <form className="copilot-composer" onSubmit={askCopilot}>
          {file ? (
            <div className="copilot-attachment copilot-attachment--inline">
              <span>Attached: {file.name}</span>
              <button type="button" onClick={clearFile} title="Remove attachment">
                Remove
              </button>
            </div>
          ) : null}
          <textarea
            rows={2}
            placeholder="Ask doctor copilot"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void askCopilot();
              }
            }}
          />
          <div className="copilot-composer-actions">
            <input
              ref={fileRef}
              className="hidden"
              type="file"
              accept=".pdf,.txt,.csv,image/png,image/jpeg,image/jpg"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <button className="copilot-icon-button" type="button" title="Attach file" onClick={() => fileRef.current?.click()}>
              +
            </button>
            <button className="copilot-icon-button" type="button" title="Dictate" onClick={listening ? stopVoiceInput : startVoiceInput}>
              {listening ? "■" : "🎙"}
            </button>
            <button className="copilot-send-button" type="submit" disabled={loading} title="Send">
              ↑
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
