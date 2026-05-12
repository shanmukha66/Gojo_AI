import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { getDb } from "./db";

type DoctorDecisionReportLike = {
  title: string;
  summary: string;
  evidenceUsed: string[];
  actionItems: string[];
  cautionPoints: string[];
  clinicianNote: string;
  provenance: {
    evidenceReferences: string[];
    model: string;
    mode: "gpt" | "fallback";
  };
};

const exportRoot = process.env.APP_EXPORTS_PATH || path.join(process.cwd(), "data", "exports");

function ensureDir(target: string) {
  fs.mkdirSync(target, { recursive: true });
}

function doctorDir(doctorId: string) {
  const dir = path.join(exportRoot, `doctor_${doctorId}`);
  ensureDir(dir);
  return dir;
}

function patientDir(doctorId: string, patientId: string) {
  const dir = path.join(doctorDir(doctorId), "patients", `patient_${patientId}`);
  ensureDir(dir);
  return dir;
}

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function writeCsv(filePath: string, rows: Array<Record<string, unknown>>) {
  ensureDir(path.dirname(filePath));
  if (rows.length === 0) {
    fs.writeFileSync(filePath, "", "utf8");
    return;
  }

  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );

  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ];

  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function writeWorkbook(filePath: string, sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }>) {
  ensureDir(path.dirname(filePath));
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows.length > 0 ? sheet.rows : [{ note: "No data available" }]);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(workbook, filePath);
}

export function exportDoctorMemosCsv(doctorId: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, doctor_id AS doctorId, title, body, type, tags, created_at AS createdAt, updated_at AS updatedAt
       FROM doctor_memos
       WHERE doctor_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .all(doctorId) as Array<Record<string, unknown>>;
  writeCsv(path.join(doctorDir(doctorId), "doctor_memos.csv"), rows);
}

export function exportPatientMemosCsv(doctorId: string, patientId: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, doctor_id AS doctorId, patient_id AS patientId, title, body, status, tags, created_at AS createdAt, updated_at AS updatedAt
       FROM patient_memos
       WHERE doctor_id = ? AND patient_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .all(doctorId, patientId) as Array<Record<string, unknown>>;
  writeCsv(path.join(patientDir(doctorId, patientId), "patient_memos.csv"), rows);
}

export function exportPatientReviewsCsv(doctorId: string, patientId: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, doctor_id AS doctorId, patient_user_id AS patientUserId, patient_record_id AS patientRecordId, visit_id AS visitId,
              appointment_id AS appointmentId, title, summary, assessment, plan, follow_up AS followUp,
              revisit_recommended AS revisitRecommended, status, tags, created_at AS createdAt, updated_at AS updatedAt
       FROM patient_reviews
       WHERE doctor_id = ? AND patient_record_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .all(doctorId, patientId) as Array<Record<string, unknown>>;
  writeCsv(path.join(patientDir(doctorId, patientId), "patient_reviews.csv"), rows);
}

export function exportDoctorAvailabilityCsv(doctorId: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, doctor_id AS doctorId, weekday, start_time AS startTime, end_time AS endTime, slot_minutes AS slotMinutes, active, created_at AS createdAt, updated_at AS updatedAt
       FROM doctor_availability
       WHERE doctor_id = ?
       ORDER BY weekday ASC, start_time ASC`,
    )
    .all(doctorId) as Array<Record<string, unknown>>;
  writeCsv(path.join(doctorDir(doctorId), "availability.csv"), rows);
}

export function exportDoctorAppointmentsCsv(doctorId: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, doctor_id AS doctorId, patient_user_id AS patientUserId, patient_record_id AS patientRecordId, slot_start AS slotStart, slot_end AS slotEnd,
              status, reason, cancellation_reason AS cancellationReason, rescheduled_from_appointment_id AS rescheduledFromAppointmentId,
              rescheduled_to_appointment_id AS rescheduledToAppointmentId, revisit_from_visit_id AS revisitFromVisitId, visit_id AS visitId,
              confirmed_at AS confirmedAt, completed_at AS completedAt, cancelled_at AS cancelledAt,
              created_by_role AS createdByRole, created_at AS createdAt, updated_at AS updatedAt
       FROM appointments
       WHERE doctor_id = ?
       ORDER BY slot_start ASC`,
    )
    .all(doctorId) as Array<Record<string, unknown>>;
  writeCsv(path.join(doctorDir(doctorId), "appointments.csv"), rows);

  const historyRows = db
    .prepare(
      `SELECT h.id, h.appointment_id AS appointmentId, h.previous_status AS previousStatus, h.next_status AS nextStatus,
              h.changed_by_user_id AS changedByUserId, h.change_reason AS changeReason, h.created_at AS createdAt
       FROM appointment_status_history h
       INNER JOIN appointments a ON a.id = h.appointment_id
       WHERE a.doctor_id = ?
       ORDER BY h.created_at ASC`,
    )
    .all(doctorId) as Array<Record<string, unknown>>;
  writeCsv(path.join(doctorDir(doctorId), "appointment_history.csv"), historyRows);
}

export function exportDoctorPatientReportWorkbook(
  doctorId: string,
  patientId: string,
  report: DoctorDecisionReportLike,
) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(patientDir(doctorId, patientId), `decision_report_${timestamp}.xlsx`);
  writeWorkbook(filePath, [
    {
      name: "summary",
      rows: [
        {
          title: report.title,
          summary: report.summary,
          clinicianNote: report.clinicianNote,
          model: report.provenance.model,
          mode: report.provenance.mode,
        },
      ],
    },
    {
      name: "evidence",
      rows: report.evidenceUsed.map((item, index) => ({ order: index + 1, evidence: item })),
    },
    {
      name: "actions",
      rows: report.actionItems.map((item, index) => ({ order: index + 1, action: item })),
    },
    {
      name: "cautions",
      rows: report.cautionPoints.map((item, index) => ({ order: index + 1, caution: item })),
    },
    {
      name: "provenance",
      rows: report.provenance.evidenceReferences.map((item, index) => ({
        order: index + 1,
        evidenceReference: item,
        model: report.provenance.model,
        mode: report.provenance.mode,
      })),
    },
  ]);
}
