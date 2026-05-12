import crypto from "crypto";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { getDb } from "./db";

type ChatMessage = {
  id: string;
  role: "doctor" | "copilot";
  text: string;
  fileName?: string;
  result?: {
    caution?: string;
    source_mode?: string;
    model?: string;
    fallback?: boolean;
    timestamp?: string;
    sources?: Array<{ title?: string; topic?: string; type?: string; content?: string }>;
  };
};

export type DoctorCopilotChat = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

const exportRoot = process.env.APP_EXPORTS_PATH || path.join(process.cwd(), "data", "exports");

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(target: string) {
  fs.mkdirSync(target, { recursive: true });
}

function doctorDir(doctorId: string) {
  const dir = path.join(exportRoot, `doctor_${doctorId}`);
  ensureDir(dir);
  return dir;
}

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath: string, rows: Array<Record<string, unknown>>) {
  ensureDir(path.dirname(filePath));
  const headers = rows.length
    ? Array.from(rows.reduce((set, row) => {
        Object.keys(row).forEach((key) => set.add(key));
        return set;
      }, new Set<string>()))
    : ["note"];
  const dataRows = rows.length ? rows : [{ note: "No doctor copilot chats yet" }];
  const lines = [headers.join(","), ...dataRows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function makeTitle(messages: ChatMessage[]) {
  const first = messages.find((message) => message.role === "doctor")?.text || "New copilot chat";
  return first.length > 64 ? `${first.slice(0, 64)}...` : first;
}

function parseMessages(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function chatRowsForExport(chats: DoctorCopilotChat[]) {
  const rows: Array<Record<string, unknown>> = [];
  for (const chat of chats) {
    for (let index = 0; index < chat.messages.length; index += 1) {
      const message = chat.messages[index];
      rows.push({
        chatId: chat.id,
        chatTitle: chat.title,
        messageIndex: index + 1,
        role: message.role,
        text: message.text,
        attachedFile: message.fileName || "",
        caution: message.result?.caution || "",
        sourceMode: message.result?.source_mode || "",
        model: message.result?.model || "",
        fallback: message.result?.fallback == null ? "" : message.result.fallback ? "yes" : "no",
        sources: message.result?.sources?.map((source) => source.title || source.topic || source.type).filter(Boolean).join(" | ") || "",
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      });
    }
  }
  return rows;
}

export function listDoctorCopilotChats(doctorId: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title, messages_json AS messagesJson, created_at AS createdAt, updated_at AS updatedAt
       FROM doctor_copilot_chats
       WHERE doctor_id = ?
       ORDER BY updated_at DESC
       LIMIT 30`,
    )
    .all(doctorId) as Array<{ id: string; title: string; messagesJson: string; createdAt: string; updatedAt: string }>;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    messages: parseMessages(row.messagesJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export function exportDoctorCopilotChats(doctorId: string) {
  const chats = listDoctorCopilotChats(doctorId);
  const rows = chatRowsForExport(chats);
  const dir = doctorDir(doctorId);
  writeCsv(path.join(dir, "doctor_copilot_chats.csv"), rows);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: "No doctor copilot chats yet" }]), "Copilot Chats");
  XLSX.writeFile(workbook, path.join(dir, "doctor_copilot_chats.xlsx"));
}

export function upsertDoctorCopilotChat(input: { doctorId: string; chatId?: string; title?: string; messages: ChatMessage[] }) {
  const db = getDb();
  const now = nowIso();
  const id = input.chatId?.trim() || crypto.randomUUID();
  const title = (input.title?.trim() || makeTitle(input.messages)).slice(0, 160);
  const messagesJson = JSON.stringify(input.messages || []);
  const existing = db.prepare(`SELECT id FROM doctor_copilot_chats WHERE id = ? AND doctor_id = ?`).get(id, input.doctorId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE doctor_copilot_chats
       SET title = ?, messages_json = ?, updated_at = ?
       WHERE id = ? AND doctor_id = ?`,
    ).run(title, messagesJson, now, id, input.doctorId);
  } else {
    db.prepare(
      `INSERT INTO doctor_copilot_chats (id, doctor_id, title, messages_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, input.doctorId, title, messagesJson, now, now);
  }

  exportDoctorCopilotChats(input.doctorId);
  return { id, title, messages: input.messages, createdAt: existing ? undefined : now, updatedAt: now };
}

export function deleteDoctorCopilotChat(doctorId: string, chatId: string) {
  const db = getDb();
  const result = db.prepare(`DELETE FROM doctor_copilot_chats WHERE id = ? AND doctor_id = ?`).run(chatId, doctorId);
  exportDoctorCopilotChats(doctorId);
  return result.changes > 0;
}
