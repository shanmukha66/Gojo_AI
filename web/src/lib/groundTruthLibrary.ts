import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "./db";
import { recordAuditEvent } from "./audit";

const CSV_PATH = path.join(process.cwd(), "data", "mock_clinical", "medical_knowledge.csv");

export type GroundTruthSource = {
  id: string;
  ownerUserId: string | null;
  title: string;
  sourceType: string;
  specialty: string | null;
  tags: string | null;
  content: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GroundTruthHit = GroundTruthSource & { score: number };

function nowIso() {
  return new Date().toISOString();
}

function parseCsv(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function csvFallbackSources(): GroundTruthHit[] {
  if (!fs.existsSync(CSV_PATH)) return [];
  const rows = parseCsv(fs.readFileSync(CSV_PATH, "utf8"));
  const headers = rows[0] || [];
  return rows.slice(1).map((values, index) => {
    const out: Record<string, string> = {};
    headers.forEach((header, i) => {
      out[header] = values[i] || "";
    });
    const now = nowIso();
    return {
      id: `csv-${index}`,
      ownerUserId: null,
      title: out.source_title || out.topic || "Local medical source",
      sourceType: out.source_type || "local_csv",
      specialty: out.topic || null,
      tags: out.keywords || null,
      content: out.content || "",
      active: true,
      createdAt: now,
      updatedAt: now,
      score: 0,
    };
  });
}

function toSource(row: any): GroundTruthSource {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId ?? null,
    title: row.title,
    sourceType: row.sourceType,
    specialty: row.specialty ?? null,
    tags: row.tags ?? null,
    content: row.content,
    active: Boolean(row.active),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function score(query: string, source: Pick<GroundTruthSource, "title" | "specialty" | "tags" | "content">) {
  const text = `${source.title} ${source.specialty || ""} ${source.tags || ""} ${source.content}`.toLowerCase();
  const stop = new Set(["what", "when", "where", "which", "with", "from", "this", "that", "have", "does", "should", "could", "would", "about", "into", "after", "before", "there", "their", "patient", "doctor", "clinical", "question", "uploaded", "image", "context"]);
  const tokens = query.toLowerCase().split(/\W+/).filter((token) => token.length > 2 && !stop.has(token));
  return tokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0);
}

export function listGroundTruthSources() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, owner_user_id AS ownerUserId, title, source_type AS sourceType, specialty, tags, content, active,
            created_at AS createdAt, updated_at AS updatedAt
     FROM ground_truth_sources
     ORDER BY updated_at DESC`,
  ).all();
  return rows.map(toSource);
}

export function searchGroundTruthSources(query: string, limit = 5): GroundTruthHit[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, owner_user_id AS ownerUserId, title, source_type AS sourceType, specialty, tags, content, active,
            created_at AS createdAt, updated_at AS updatedAt
     FROM ground_truth_sources
     WHERE active = 1
     ORDER BY updated_at DESC`,
  ).all().map(toSource);
  const sources = rows.length ? rows : csvFallbackSources();
  return sources
    .map((source) => ({ ...source, score: score(query, source) }))
    .filter((source) => source.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function createGroundTruthSource(input: {
  ownerUserId: string;
  title: string;
  sourceType: string;
  specialty?: string | null;
  tags?: string | null;
  content: string;
}) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO ground_truth_sources (id, owner_user_id, title, source_type, specialty, tags, content, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, input.ownerUserId, input.title.trim(), input.sourceType.trim() || "manual", input.specialty || null, input.tags || null, input.content.trim(), now, now);
  recordAuditEvent({ actorUserId: input.ownerUserId, actorRole: "DOCTOR", action: "ground_truth_source.create", entityType: "ground_truth_source", entityId: id, metadata: { title: input.title, sourceType: input.sourceType } });
  return id;
}

export function setGroundTruthSourceActive(input: { actorUserId: string; id: string; active: boolean }) {
  const db = getDb();
  const now = nowIso();
  const result = db.prepare(`UPDATE ground_truth_sources SET active = ?, updated_at = ? WHERE id = ?`).run(input.active ? 1 : 0, now, input.id);
  recordAuditEvent({ actorUserId: input.actorUserId, actorRole: "DOCTOR", action: input.active ? "ground_truth_source.activate" : "ground_truth_source.archive", entityType: "ground_truth_source", entityId: input.id });
  return result.changes > 0;
}
