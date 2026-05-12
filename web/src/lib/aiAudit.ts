import crypto from "crypto";
import { getDb } from "./db";

function nowIso() {
  return new Date().toISOString();
}

export function createAiAuditLog(input: {
  doctorId: string;
  patientId?: string | null;
  kind: string;
  model: string;
  fallback: boolean;
  evidenceRefs: string[];
  response: unknown;
}) {
  const db = getDb();
  db.prepare(
    `INSERT INTO ai_audit_logs (id, doctor_id, patient_id, kind, model, fallback, evidence_refs, response_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    input.doctorId,
    input.patientId ?? null,
    input.kind,
    input.model,
    input.fallback ? 1 : 0,
    JSON.stringify(input.evidenceRefs),
    JSON.stringify(input.response),
    nowIso(),
  );
}
