import crypto from "crypto";
import { getDb } from "./db";
import { requireDoctorPatientAccess } from "./clinicalOwnership";
import { exportPatientReviewsCsv } from "./recordExports";

function nowIso() {
  return new Date().toISOString();
}

type ReviewRow = {
  id: string;
  doctor_id: string;
  patient_user_id: string | null;
  patient_record_id: string;
  visit_id: string | null;
  appointment_id: string | null;
  title: string;
  summary: string;
  assessment: string | null;
  plan: string | null;
  follow_up: string | null;
  revisit_recommended: number;
  status: string;
  tags: string | null;
  created_at: string;
  updated_at: string;
};

export type PatientReview = {
  id: string;
  doctorId: string;
  patientUserId: string | null;
  patientRecordId: string;
  visitId: string | null;
  appointmentId: string | null;
  title: string;
  summary: string;
  assessment: string | null;
  plan: string | null;
  followUp: string | null;
  revisitRecommended: boolean;
  status: string;
  tags: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapReview(row: ReviewRow): PatientReview {
  return {
    id: row.id,
    doctorId: row.doctor_id,
    patientUserId: row.patient_user_id,
    patientRecordId: row.patient_record_id,
    visitId: row.visit_id,
    appointmentId: row.appointment_id,
    title: row.title,
    summary: row.summary,
    assessment: row.assessment,
    plan: row.plan,
    followUp: row.follow_up,
    revisitRecommended: Boolean(row.revisit_recommended),
    status: row.status,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getReviewRow(doctorId: string, reviewId: string) {
  const db = getDb();
  return db
    .prepare(
      `${reviewSelectSql()}
       WHERE id = ? AND doctor_id = ?`,
    )
    .get(reviewId, doctorId) as ReviewRow | undefined;
}

function reviewSelectSql() {
  return `SELECT id, doctor_id, patient_user_id, patient_record_id, visit_id, appointment_id, title, summary, assessment, plan, follow_up, revisit_recommended, status, tags, created_at, updated_at
       FROM patient_reviews
       `;
}

export function listPatientReviews(doctorId: string, patientRecordId: string) {
  requireDoctorPatientAccess(doctorId, patientRecordId);
  const db = getDb();
  const rows = db
    .prepare(
      `${reviewSelectSql()}
       WHERE doctor_id = ? AND patient_record_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .all(doctorId, patientRecordId) as ReviewRow[];
  return rows.map(mapReview);
}

export function createPatientReview(input: {
  doctorId: string;
  patientRecordId: string;
  patientUserId?: string | null;
  visitId?: string | null;
  appointmentId?: string | null;
  title: string;
  summary: string;
  assessment?: string | null;
  plan?: string | null;
  followUp?: string | null;
  revisitRecommended?: boolean;
  status?: string;
  tags?: string | null;
}) {
  requireDoctorPatientAccess(input.doctorId, input.patientRecordId);
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO patient_reviews
      (id, doctor_id, patient_user_id, patient_record_id, visit_id, appointment_id, title, summary, assessment, plan, follow_up, revisit_recommended, status, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.doctorId,
    input.patientUserId ?? null,
    input.patientRecordId,
    input.visitId ?? null,
    input.appointmentId ?? null,
    input.title,
    input.summary,
    input.assessment ?? null,
    input.plan ?? null,
    input.followUp ?? null,
    input.revisitRecommended ? 1 : 0,
    input.status ?? "draft",
    input.tags ?? null,
    now,
    now,
  );
  exportPatientReviewsCsv(input.doctorId, input.patientRecordId);
  const row = getReviewRow(input.doctorId, id);
  return row ? mapReview(row) : null;
}

export function updatePatientReview(
  doctorId: string,
  reviewId: string,
  updates: Partial<Pick<PatientReview, "title" | "summary" | "assessment" | "plan" | "followUp" | "revisitRecommended" | "status" | "tags">>,
) {
  const existing = getReviewRow(doctorId, reviewId);
  if (!existing) return null;
  requireDoctorPatientAccess(doctorId, existing.patient_record_id);
  const db = getDb();
  const updatedAt = nowIso();
  db.prepare(
    `UPDATE patient_reviews
     SET title = ?, summary = ?, assessment = ?, plan = ?, follow_up = ?, revisit_recommended = ?, status = ?, tags = ?, updated_at = ?
     WHERE id = ? AND doctor_id = ?`,
  ).run(
    updates.title ?? existing.title,
    updates.summary ?? existing.summary,
    updates.assessment === undefined ? existing.assessment : updates.assessment,
    updates.plan === undefined ? existing.plan : updates.plan,
    updates.followUp === undefined ? existing.follow_up : updates.followUp,
    updates.revisitRecommended === undefined ? existing.revisit_recommended : updates.revisitRecommended ? 1 : 0,
    updates.status ?? existing.status,
    updates.tags === undefined ? existing.tags : updates.tags,
    updatedAt,
    reviewId,
    doctorId,
  );
  exportPatientReviewsCsv(doctorId, existing.patient_record_id);
  const row = getReviewRow(doctorId, reviewId);
  return row ? mapReview(row) : null;
}

export function deletePatientReview(doctorId: string, reviewId: string) {
  const existing = getReviewRow(doctorId, reviewId);
  if (!existing) return false;
  requireDoctorPatientAccess(doctorId, existing.patient_record_id);
  const db = getDb();
  const result = db.prepare("DELETE FROM patient_reviews WHERE id = ? AND doctor_id = ?").run(reviewId, doctorId);
  exportPatientReviewsCsv(doctorId, existing.patient_record_id);
  return result.changes > 0;
}
