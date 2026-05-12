import crypto from "crypto";
import { getDb } from "./db";

function nowIso() {
  return new Date().toISOString();
}

type AssignmentRow = {
  id: string;
  doctor_id: string;
  patient_user_id: string | null;
  patient_record_id: string;
  source: string;
  assigned_at: string;
  released_at: string | null;
  active: number;
  notes: string | null;
};

export type DoctorPatientAssignment = {
  id: string;
  doctorId: string;
  patientUserId: string | null;
  patientRecordId: string;
  source: string;
  assignedAt: string;
  releasedAt: string | null;
  active: boolean;
  notes: string | null;
};

function mapAssignment(row: AssignmentRow): DoctorPatientAssignment {
  return {
    id: row.id,
    doctorId: row.doctor_id,
    patientUserId: row.patient_user_id,
    patientRecordId: row.patient_record_id,
    source: row.source,
    assignedAt: row.assigned_at,
    releasedAt: row.released_at,
    active: Boolean(row.active),
    notes: row.notes,
  };
}

export function ensureDoctorProfile(userId: string) {
  const db = getDb();
  const now = nowIso();
  db.prepare(
    `INSERT INTO doctor_profiles (user_id, created_at, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET updated_at = excluded.updated_at`,
  ).run(userId, now, now);
}

export function assignDoctorToPatient(input: {
  doctorId: string;
  patientRecordId: string;
  patientUserId?: string | null;
  source: string;
  notes?: string | null;
}) {
  ensureDoctorProfile(input.doctorId);
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id, doctor_id, patient_user_id, patient_record_id, source, assigned_at, released_at, active, notes
       FROM doctor_patient_assignments
       WHERE doctor_id = ? AND patient_record_id = ? AND active = 1
       LIMIT 1`,
    )
    .get(input.doctorId, input.patientRecordId) as AssignmentRow | undefined;

  if (existing) {
    if (input.patientUserId && !existing.patient_user_id) {
      db.prepare(
        `UPDATE doctor_patient_assignments
         SET patient_user_id = ?
         WHERE id = ?`,
      ).run(input.patientUserId, existing.id);
    }
    return getDoctorPatientAssignment(input.doctorId, input.patientRecordId);
  }

  const id = crypto.randomUUID();
  const assignedAt = nowIso();
  db.prepare(
    `INSERT INTO doctor_patient_assignments
      (id, doctor_id, patient_user_id, patient_record_id, source, assigned_at, released_at, active, notes)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?)`,
  ).run(
    id,
    input.doctorId,
    input.patientUserId ?? null,
    input.patientRecordId,
    input.source,
    assignedAt,
    input.notes ?? null,
  );

  return getDoctorPatientAssignment(input.doctorId, input.patientRecordId);
}

export function getDoctorPatientAssignment(doctorId: string, patientRecordId: string) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, doctor_id, patient_user_id, patient_record_id, source, assigned_at, released_at, active, notes
       FROM doctor_patient_assignments
       WHERE doctor_id = ? AND patient_record_id = ? AND active = 1
       LIMIT 1`,
    )
    .get(doctorId, patientRecordId) as AssignmentRow | undefined;
  return row ? mapAssignment(row) : null;
}

export function listDoctorAssignments(doctorId: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, doctor_id, patient_user_id, patient_record_id, source, assigned_at, released_at, active, notes
       FROM doctor_patient_assignments
       WHERE doctor_id = ? AND active = 1
       ORDER BY assigned_at DESC`,
    )
    .all(doctorId) as AssignmentRow[];
  return rows.map(mapAssignment);
}

export function canDoctorAccessPatientRecord(doctorId: string, patientRecordId: string) {
  const db = getDb();
  const assignment = db
    .prepare(
      `SELECT 1
       FROM doctor_patient_assignments
       WHERE doctor_id = ? AND patient_record_id = ? AND active = 1
       LIMIT 1`,
    )
    .get(doctorId, patientRecordId);
  if (assignment) return true;

  const completedVisit = db
    .prepare(
      `SELECT 1
       FROM visits
       WHERE doctor_id = ? AND patient_record_id = ?
       LIMIT 1`,
    )
    .get(doctorId, patientRecordId);

  return Boolean(completedVisit);
}

export function requireDoctorPatientAccess(doctorId: string, patientRecordId: string) {
  if (!canDoctorAccessPatientRecord(doctorId, patientRecordId)) {
    throw new Error("Doctor is not assigned to this patient record.");
  }
}
