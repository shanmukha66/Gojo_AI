import crypto from "crypto";
import { getDb } from "./db";
import { exportDoctorMemosCsv, exportPatientMemosCsv } from "./recordExports";
import { requireDoctorPatientAccess } from "./clinicalOwnership";

export type DoctorMemo = {
  id: string;
  doctorId: string;
  title: string;
  body: string;
  type: string;
  tags: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PatientMemo = {
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

function nowIso() {
  return new Date().toISOString();
}

function mapDoctorMemo(row: {
  id: string;
  doctor_id: string;
  title: string;
  body: string;
  type: string;
  tags: string | null;
  created_at: string;
  updated_at: string;
}): DoctorMemo {
  return {
    id: row.id,
    doctorId: row.doctor_id,
    title: row.title,
    body: row.body,
    type: row.type,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPatientMemo(row: {
  id: string;
  doctor_id: string;
  patient_id: string;
  title: string;
  body: string;
  status: string;
  tags: string | null;
  created_at: string;
  updated_at: string;
}): PatientMemo {
  return {
    id: row.id,
    doctorId: row.doctor_id,
    patientId: row.patient_id,
    title: row.title,
    body: row.body,
    status: row.status,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listDoctorMemos(doctorId: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, doctor_id, title, body, type, tags, created_at, updated_at
       FROM doctor_memos
       WHERE doctor_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .all(doctorId) as Array<{
      id: string;
      doctor_id: string;
      title: string;
      body: string;
      type: string;
      tags: string | null;
      created_at: string;
      updated_at: string;
    }>;

  return rows.map(mapDoctorMemo);
}

export function createDoctorMemo(doctorId: string, input: { title: string; body: string; type?: string; tags?: string | null }) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO doctor_memos (id, doctor_id, title, body, type, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, doctorId, input.title, input.body, input.type || "general", input.tags || null, now, now);
  exportDoctorMemosCsv(doctorId);

  return listDoctorMemos(doctorId).find((memo) => memo.id === id) ?? null;
}

export function updateDoctorMemo(
  doctorId: string,
  memoId: string,
  updates: { title?: string; body?: string; type?: string; tags?: string | null },
) {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id, doctor_id, title, body, type, tags, created_at, updated_at
       FROM doctor_memos
       WHERE id = ? AND doctor_id = ?`,
    )
    .get(memoId, doctorId) as
    | {
        id: string;
        doctor_id: string;
        title: string;
        body: string;
        type: string;
        tags: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!existing) return null;

  const updatedAt = nowIso();
  db.prepare(
    `UPDATE doctor_memos
     SET title = ?, body = ?, type = ?, tags = ?, updated_at = ?
     WHERE id = ? AND doctor_id = ?`,
  ).run(
    updates.title ?? existing.title,
    updates.body ?? existing.body,
    updates.type ?? existing.type,
    updates.tags === undefined ? existing.tags : updates.tags,
    updatedAt,
    memoId,
    doctorId,
  );
  exportDoctorMemosCsv(doctorId);

  return listDoctorMemos(doctorId).find((memo) => memo.id === memoId) ?? null;
}

export function deleteDoctorMemo(doctorId: string, memoId: string) {
  const db = getDb();
  const result = db.prepare("DELETE FROM doctor_memos WHERE id = ? AND doctor_id = ?").run(memoId, doctorId);
  exportDoctorMemosCsv(doctorId);
  return result.changes > 0;
}

export function listPatientMemos(doctorId: string, patientId: string) {
  requireDoctorPatientAccess(doctorId, patientId);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, doctor_id, patient_id, title, body, status, tags, created_at, updated_at
       FROM patient_memos
       WHERE doctor_id = ? AND patient_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .all(doctorId, patientId) as Array<{
      id: string;
      doctor_id: string;
      patient_id: string;
      title: string;
      body: string;
      status: string;
      tags: string | null;
      created_at: string;
      updated_at: string;
    }>;

  return rows.map(mapPatientMemo);
}

export function createPatientMemo(
  doctorId: string,
  patientId: string,
  input: { title: string; body: string; status?: string; tags?: string | null },
) {
  requireDoctorPatientAccess(doctorId, patientId);
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO patient_memos (id, doctor_id, patient_id, title, body, status, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, doctorId, patientId, input.title, input.body, input.status || "open", input.tags || null, now, now);
  exportPatientMemosCsv(doctorId, patientId);

  return listPatientMemos(doctorId, patientId).find((memo) => memo.id === id) ?? null;
}

export function updatePatientMemo(
  doctorId: string,
  patientId: string,
  memoId: string,
  updates: { title?: string; body?: string; status?: string; tags?: string | null },
) {
  requireDoctorPatientAccess(doctorId, patientId);
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id, doctor_id, patient_id, title, body, status, tags, created_at, updated_at
       FROM patient_memos
       WHERE id = ? AND doctor_id = ? AND patient_id = ?`,
    )
    .get(memoId, doctorId, patientId) as
    | {
        id: string;
        doctor_id: string;
        patient_id: string;
        title: string;
        body: string;
        status: string;
        tags: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!existing) return null;

  const updatedAt = nowIso();
  db.prepare(
    `UPDATE patient_memos
     SET title = ?, body = ?, status = ?, tags = ?, updated_at = ?
     WHERE id = ? AND doctor_id = ? AND patient_id = ?`,
  ).run(
    updates.title ?? existing.title,
    updates.body ?? existing.body,
    updates.status ?? existing.status,
    updates.tags === undefined ? existing.tags : updates.tags,
    updatedAt,
    memoId,
    doctorId,
    patientId,
  );
  exportPatientMemosCsv(doctorId, patientId);

  return listPatientMemos(doctorId, patientId).find((memo) => memo.id === memoId) ?? null;
}

export function deletePatientMemo(doctorId: string, patientId: string, memoId: string) {
  requireDoctorPatientAccess(doctorId, patientId);
  const db = getDb();
  const result = db
    .prepare("DELETE FROM patient_memos WHERE id = ? AND doctor_id = ? AND patient_id = ?")
    .run(memoId, doctorId, patientId);
  exportPatientMemosCsv(doctorId, patientId);
  return result.changes > 0;
}
