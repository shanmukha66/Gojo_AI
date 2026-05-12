import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDb } from "./db";
import { runQuery } from "./neo4j";
import { assignDoctorToPatient } from "./clinicalOwnership";

const MOCK_ROOT = path.join(process.cwd(), "data", "mock_clinical");
const MOCK_PASSWORD_HASH = "$2a$10$0q7U1P9ZwZpJgVn20L7McOehuM2wzjV7w2PRK8Ct4QvIMw4T8vE8G";

type PatientCsv = {
  patient_record_id: string;
  patient_user_id: string;
  name: string;
  email: string;
  age: string;
  gender: string;
  risk: string;
  signals: string;
  conditions: string;
};

type VisitCsv = {
  visit_id: string;
  patient_record_id: string;
  start: string;
  end: string;
  type: string;
  title: string;
  description: string;
};

type ReportCsv = {
  document_id: string;
  patient_record_id: string;
  patient_user_id: string;
  file_name: string;
  report_date: string;
  extracted_text: string;
};

type AppointmentCsv = {
  appointment_id: string;
  patient_record_id: string;
  patient_user_id: string;
  slot_start: string;
  slot_end: string;
  status: string;
  reason: string;
};

type ReviewCsv = {
  review_id: string;
  patient_record_id: string;
  patient_user_id: string;
  title: string;
  summary: string;
  assessment: string;
  plan: string;
  follow_up: string;
  revisit_recommended: string;
  status: string;
  tags: string;
};

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
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

function readCsv<T extends Record<string, string>>(fileName: string): T[] {
  const file = path.join(MOCK_ROOT, fileName);
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const headers = rows[0];
  return rows.slice(1).map((values) => {
    const out: Record<string, string> = {};
    headers.forEach((header, index) => {
      out[header] = (values[index] ?? "").replace(/\\n/g, "\n").trim();
    });
    return out as T;
  });
}

function splitSignals(value: string) {
  return value.split(";").map((item) => item.trim()).filter(Boolean);
}

function splitPipe(value: string) {
  return value.split("|").map((item) => item.trim()).filter(Boolean);
}

function chunksFor(text: string) {
  const paragraphs = text.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
    } else if (`${current}\n${paragraph}`.length <= 700) {
      current = `${current}\n${paragraph}`;
    } else {
      chunks.push(current);
      current = paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text.slice(0, 700)];
}

function detectFlag(value?: string) {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (["high", "low", "normal", "abnormal"].includes(lower)) return lower;
  return null;
}

function extractObservations(text: string, reportDate: string) {
  const pattern = /^([A-Za-z][A-Za-z0-9 /()%._-]{2,})\s+(-?\d+(?:\.\d+)?)\s*([A-Za-z%/0-9.uµ^.-]+)?\s*(\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:\s*[A-Za-z%/0-9.uµ^.-]+)?)?\s*(High|Low|Normal|Abnormal)?$/i;
  return text
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.match(pattern))
    .filter(Boolean)
    .map((match) => ({
      testName: match?.[1]?.trim() || "Observation",
      valueText: match?.[2]?.trim() || null,
      numericValue: Number(match?.[2]),
      unit: match?.[3]?.trim() || null,
      referenceRange: match?.[4]?.trim() || null,
      abnormalFlag: detectFlag(match?.[5]),
      observedAt: reportDate,
    }))
    .filter((item) => item.testName && item.valueText)
    .slice(0, 30);
}

function upsertPatientUsers(patients: PatientCsv[]) {
  const db = getDb();
  const timestamp = nowIso();
  for (const patient of patients) {
    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, 'PATIENT', ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email`,
    ).run(patient.patient_user_id, patient.name, patient.email.toLowerCase(), MOCK_PASSWORD_HASH, timestamp);
    db.prepare(
      `INSERT INTO patient_record_links (user_id, patient_record_id, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET patient_record_id = excluded.patient_record_id, updated_at = excluded.updated_at`,
    ).run(patient.patient_user_id, patient.patient_record_id, timestamp);
  }
}

async function upsertNeo4j(patients: PatientCsv[], visits: VisitCsv[]) {
  await runQuery(
    `UNWIND $patients AS row
     MERGE (p:Patient {id: row.id})
     SET p.name = row.name,
         p.age = row.age,
         p.gender = row.gender,
         p.risk = row.risk,
         p.signals = row.signals,
         p.mock = true`,
    {
      patients: patients.map((patient) => ({
        id: patient.patient_record_id,
        name: patient.name,
        age: Number(patient.age),
        gender: patient.gender,
        risk: Number(patient.risk),
        signals: splitSignals(patient.signals),
      })),
    },
  );

  const conditionRows = patients.flatMap((patient) =>
    splitPipe(patient.conditions).map((code) => ({ patientId: patient.patient_record_id, code })),
  );
  await runQuery(
    `UNWIND $rows AS row
     MATCH (p:Patient {id: row.patientId})
     MERGE (c:Condition {code: row.code})
     MERGE (p)-[:HAS_CONDITION]->(c)`,
    { rows: conditionRows },
  );

  await runQuery(
    `UNWIND $visits AS row
     MATCH (p:Patient {id: row.patientId})
     MERGE (v:Visit {id: row.id})
     SET v.start = row.start,
         v.end = row.end,
         v.type = row.type,
         v.title = row.title,
         v.description = row.description,
         v.mock = true
     MERGE (p)-[:HAD_VISIT]->(v)`,
    {
      visits: visits.map((visit) => ({
        id: visit.visit_id,
        patientId: visit.patient_record_id,
        start: visit.start,
        end: visit.end,
        type: visit.type,
        title: visit.title,
        description: visit.description,
      })),
    },
  );
}

function upsertReports(reports: ReportCsv[]) {
  const db = getDb();
  const timestamp = nowIso();
  for (const report of reports) {
    const storedName = `${report.document_id}.txt`;
    const storagePath = path.join(MOCK_ROOT, storedName);
    fs.writeFileSync(storagePath, report.extracted_text, "utf8");
    db.prepare(
      `INSERT INTO patient_documents
        (id, user_id, file_name, stored_name, mime_type, file_size, status, extraction_error, storage_path, extracted_text, report_date,
         extraction_version, parser_version, report_version, interpretation_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'application/pdf', ?, 'processed', NULL, ?, ?, ?, 1, 1, 1, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         file_name = excluded.file_name,
         status = 'processed',
         extracted_text = excluded.extracted_text,
         report_date = excluded.report_date,
         updated_at = excluded.updated_at`,
    ).run(
      report.document_id,
      report.patient_user_id,
      report.file_name,
      storedName,
      Buffer.byteLength(report.extracted_text),
      storagePath,
      report.extracted_text,
      report.report_date,
      timestamp,
      timestamp,
    );

    db.prepare("DELETE FROM document_chunks WHERE document_id = ?").run(report.document_id);
    chunksFor(report.extracted_text).forEach((chunk, index) => {
      db.prepare(
        `INSERT INTO document_chunks (id, document_id, chunk_index, content, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(`${report.document_id}-chunk-${index}`, report.document_id, index, chunk, timestamp);
    });

    db.prepare("DELETE FROM lab_observations WHERE document_id = ?").run(report.document_id);
    extractObservations(report.extracted_text, report.report_date).forEach((obs, index) => {
      db.prepare(
        `INSERT INTO lab_observations
          (id, document_id, user_id, test_name, value_text, numeric_value, unit, reference_range, abnormal_flag, observed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `${report.document_id}-obs-${index}`,
        report.document_id,
        report.patient_user_id,
        obs.testName,
        obs.valueText,
        Number.isFinite(obs.numericValue) ? obs.numericValue : null,
        obs.unit,
        obs.referenceRange,
        obs.abnormalFlag,
        obs.observedAt,
        timestamp,
      );
    });
  }
}

function upsertDoctorSideSql(input: {
  doctorId: string;
  patients: PatientCsv[];
  appointments: AppointmentCsv[];
  reviews: ReviewCsv[];
  visits: VisitCsv[];
}) {
  const db = getDb();
  const timestamp = nowIso();
  for (const patient of input.patients) {
    assignDoctorToPatient({
      doctorId: input.doctorId,
      patientRecordId: patient.patient_record_id,
      patientUserId: patient.patient_user_id,
      source: "mock_csv_loader",
      notes: "Realistic mock clinical chart loaded from backend CSV files.",
    });
  }

  for (const visit of input.visits) {
    db.prepare(
      `INSERT INTO visits
        (id, doctor_id, patient_user_id, patient_record_id, appointment_id, reason, status, started_at, ended_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, 'completed', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = 'completed', started_at = excluded.started_at, ended_at = excluded.ended_at, updated_at = excluded.updated_at`,
    ).run(
      visit.visit_id,
      input.doctorId,
      input.patients.find((patient) => patient.patient_record_id === visit.patient_record_id)?.patient_user_id ?? null,
      visit.patient_record_id,
      visit.title,
      visit.start,
      visit.end,
      timestamp,
      timestamp,
    );
  }

  for (const appointment of input.appointments) {
    db.prepare(
      `INSERT INTO appointments
        (id, doctor_id, patient_user_id, patient_record_id, slot_start, slot_end, status, reason, created_by_role, created_at, updated_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DOCTOR', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        slot_start = excluded.slot_start,
        slot_end = excluded.slot_end,
        status = excluded.status,
        reason = excluded.reason,
        updated_at = excluded.updated_at,
        confirmed_at = excluded.confirmed_at`,
    ).run(
      appointment.appointment_id,
      input.doctorId,
      appointment.patient_user_id,
      appointment.patient_record_id,
      appointment.slot_start,
      appointment.slot_end,
      appointment.status,
      appointment.reason,
      timestamp,
      timestamp,
      appointment.status === "confirmed" ? timestamp : null,
    );
    db.prepare("DELETE FROM appointment_status_history WHERE appointment_id = ?").run(appointment.appointment_id);
    db.prepare(
      `INSERT INTO appointment_status_history (id, appointment_id, previous_status, next_status, changed_by_user_id, change_reason, created_at)
       VALUES (?, ?, NULL, ?, ?, 'Loaded from realistic backend CSV mock data', ?)`,
    ).run(crypto.randomUUID(), appointment.appointment_id, appointment.status, input.doctorId, timestamp);
  }

  for (const review of input.reviews) {
    db.prepare(
      `INSERT INTO patient_reviews
        (id, doctor_id, patient_user_id, patient_record_id, visit_id, appointment_id, title, summary, assessment, plan, follow_up, revisit_recommended, status, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        assessment = excluded.assessment,
        plan = excluded.plan,
        follow_up = excluded.follow_up,
        revisit_recommended = excluded.revisit_recommended,
        status = excluded.status,
        tags = excluded.tags,
        updated_at = excluded.updated_at`,
    ).run(
      review.review_id,
      input.doctorId,
      review.patient_user_id,
      review.patient_record_id,
      review.title,
      review.summary,
      review.assessment,
      review.plan,
      review.follow_up,
      review.revisit_recommended === "1" ? 1 : 0,
      review.status || "signed",
      review.tags,
      timestamp,
      timestamp,
    );
  }

  const weekdays = [1, 2, 3, 4, 5];
  for (const weekday of weekdays) {
    const id = `mock-availability-${input.doctorId}-${weekday}`;
    db.prepare(
      `INSERT INTO doctor_availability (id, doctor_id, weekday, start_time, end_time, slot_minutes, active, created_at, updated_at)
       VALUES (?, ?, ?, '09:00', '17:00', 30, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET active = 1, updated_at = excluded.updated_at`,
    ).run(id, input.doctorId, weekday, timestamp, timestamp);
  }
}

export function listMockClinicalCsvFiles() {
  if (!fs.existsSync(MOCK_ROOT)) return [];
  return fs.readdirSync(MOCK_ROOT).filter((file) => file.endsWith(".csv")).sort();
}

export function getMockClinicalCsvPath(fileName: string) {
  const safeName = path.basename(fileName);
  if (!safeName.endsWith(".csv")) return null;
  const target = path.join(MOCK_ROOT, safeName);
  return target.startsWith(MOCK_ROOT) && fs.existsSync(target) ? target : null;
}

export async function loadMockClinicalData(doctorId: string) {
  const patients = readCsv<PatientCsv>("patients.csv");
  const visits = readCsv<VisitCsv>("visits.csv");
  const reports = readCsv<ReportCsv>("reports.csv");
  const appointments = readCsv<AppointmentCsv>("appointments.csv");
  const reviews = readCsv<ReviewCsv>("reviews.csv");

  upsertPatientUsers(patients);
  await upsertNeo4j(patients, visits);
  upsertReports(reports);
  upsertDoctorSideSql({ doctorId, patients, appointments, reviews, visits });

  return {
    patients: patients.length,
    visits: visits.length,
    reports: reports.length,
    appointments: appointments.length,
    reviews: reviews.length,
    files: listMockClinicalCsvFiles(),
    firstPatientId: patients[0]?.patient_record_id ?? null,
  };
}

type Neo4jPatientRow = {
  p: { id: string; name?: string; age?: number; gender?: string; risk?: number; signals?: string[] };
};

const GENERATED_CASES = [
  {
    key: "diabetes_renal",
    signals: ["diabetes follow-up", "renal monitoring", "medication adherence"],
    conditions: ["E11.9", "N18.30", "I10"],
    visitType: "Outpatient",
    visitTitle: "Diabetes and renal follow-up",
    reportName: "Diabetes_Renal_Panel",
    labs: [
      ["Hemoglobin A1c", "8.9", "%", "4.0-5.6", "High"],
      ["Glucose", "214", "mg/dL", "70-99", "High"],
      ["Creatinine", "1.42", "mg/dL", "0.57-1.00", "High"],
      ["eGFR", "49", "mL/min/1.73m2", "60-120", "Low"],
    ],
    reviewTitle: "Diabetes risk review",
    assessment: "Glycemic control and renal markers need close follow-up with chart-specific medication review.",
    plan: "Review glucose logs, kidney function trend, blood pressure, medication adherence, and contraindications before changing therapy.",
  },
  {
    key: "copd_transition",
    signals: ["COPD monitoring", "recent respiratory symptoms", "inhaler review"],
    conditions: ["J44.9", "Z87.891", "I10"],
    visitType: "Emergency",
    visitTitle: "Respiratory symptom evaluation",
    reportName: "Pulmonary_Status_Report",
    labs: [
      ["Oxygen Saturation", "91", "%", "95-100", "Low"],
      ["WBC", "12.6", "K/uL", "4.0-11.0", "High"],
      ["Respiratory Rate", "22", "/min", "12-20", "High"],
      ["Chest X-Ray", "0", "summary", "0-0", "Normal"],
    ],
    reviewTitle: "COPD follow-up review",
    assessment: "Respiratory status requires follow-up because recent symptoms and oxygen trend increase revisit risk.",
    plan: "Review inhaler technique, rescue medication use, symptom triggers, oxygen trend, and return precautions.",
  },
  {
    key: "heart_failure",
    signals: ["heart failure monitoring", "fluid status", "electrolyte follow-up"],
    conditions: ["I50.9", "I25.10", "N18.31"],
    visitType: "Inpatient",
    visitTitle: "Heart failure transition visit",
    reportName: "Cardiology_CMP_BNP",
    labs: [
      ["BNP", "860", "pg/mL", "0-100", "High"],
      ["Potassium", "5.2", "mmol/L", "3.5-5.1", "High"],
      ["Creatinine", "1.55", "mg/dL", "0.7-1.3", "High"],
      ["Sodium", "134", "mmol/L", "135-145", "Low"],
    ],
    reviewTitle: "Heart failure transition review",
    assessment: "Volume status, renal function, and electrolytes need close transition-of-care review.",
    plan: "Check daily weights, dyspnea, edema, medication reconciliation, sodium intake, and repeat metabolic panel timing.",
  },
  {
    key: "anemia",
    signals: ["fatigue", "anemia workup", "iron monitoring"],
    conditions: ["D50.9", "R53.83"],
    visitType: "Outpatient",
    visitTitle: "Anemia and fatigue review",
    reportName: "CBC_Iron_Studies",
    labs: [
      ["Hemoglobin", "10.4", "g/dL", "12.0-15.5", "Low"],
      ["MCV", "74", "fL", "80-100", "Low"],
      ["Ferritin", "11", "ng/mL", "15-150", "Low"],
      ["Iron Saturation", "12", "%", "20-50", "Low"],
    ],
    reviewTitle: "Anemia follow-up review",
    assessment: "Lab pattern suggests iron deficiency context, but source and symptom burden need patient-specific review.",
    plan: "Review bleeding history, diet, medication tolerance, fatigue severity, and need for additional evaluation.",
  },
  {
    key: "thyroid_metabolic",
    signals: ["thyroid monitoring", "palpitations", "metabolic follow-up"],
    conditions: ["E03.9", "R00.2"],
    visitType: "Outpatient",
    visitTitle: "Thyroid symptom follow-up",
    reportName: "Thyroid_Metabolic_Panel",
    labs: [
      ["TSH", "5.6", "uIU/mL", "0.4-4.5", "High"],
      ["Free T4", "0.9", "ng/dL", "0.8-1.8", "Normal"],
      ["Heart Rate", "96", "bpm", "60-100", "Normal"],
      ["Vitamin D", "22", "ng/mL", "30-100", "Low"],
    ],
    reviewTitle: "Thyroid follow-up review",
    assessment: "Mild thyroid abnormality needs symptom correlation and repeat testing rather than isolated interpretation.",
    plan: "Review palpitations, weight change, medication timing, postpartum status if relevant, and repeat thyroid testing interval.",
  },
];

function hashNumber(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

function generatedDate(seed: number, dayOffset: number) {
  const base = new Date(Date.UTC(2026, 2, 1 + ((seed + dayOffset) % 50), 9 + (seed % 8), (seed * 7) % 60));
  return base.toISOString();
}

function generatedReportText(input: {
  patientName: string;
  reportDate: string;
  caseTemplate: (typeof GENERATED_CASES)[number];
  seed: number;
}) {
  const adjustedLabs = input.caseTemplate.labs.map(([name, value, unit, range, flag], index) => {
    const numeric = Number(value);
    const nextValue = Number.isFinite(numeric) ? (numeric + ((input.seed + index) % 5) * 0.1).toFixed(value.includes(".") ? 1 : 0) : value;
    return `${name} ${nextValue} ${unit} ${range} ${flag}`;
  });
  return [
    `GOJO Health Partner Laboratory`,
    `Patient: ${input.patientName}`,
    `Report Date: ${input.reportDate.slice(0, 10)}`,
    ...adjustedLabs,
    `Clinical note: ${input.caseTemplate.assessment} This report is generated as realistic backend mock data for workflow testing and should not be treated as real patient information.`,
  ].join("\n");
}

export async function loadGeneratedClinicalDataForAllPatients(doctorId: string) {
  const rows = await runQuery<Neo4jPatientRow>(
    `MATCH (p:Patient)
     WHERE p.id IS NOT NULL AND p.id <> "undefined"
     RETURN p { .* } AS p
     ORDER BY toString(p.id) ASC`,
  );
  const patients = rows.map((row) => row.p).filter((patient) => patient?.id);
  const db = getDb();
  const timestamp = nowIso();
  let reports = 0;
  let visits = 0;
  let appointments = 0;
  let reviews = 0;

  for (const patient of patients) {
    const patientId = String(patient.id);
    const seed = hashNumber(patientId);
    const caseTemplate = GENERATED_CASES[seed % GENERATED_CASES.length];
    const patientUserId = `mock-patient-${patientId}`;
    const patientName = patient.name || `Patient ${patientId}`;
    const email = `patient.${patientId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}@gojo.mock`;
    const visitStart = generatedDate(seed, 2);
    const visitEnd = new Date(new Date(visitStart).getTime() + 35 * 60 * 1000).toISOString();
    const reportDate = generatedDate(seed, 5).slice(0, 10);
    const appointmentStart = generatedDate(seed, 70);
    const appointmentEnd = new Date(new Date(appointmentStart).getTime() + 30 * 60 * 1000).toISOString();
    const reportId = `generated-report-${patientId}-${caseTemplate.key}`;
    const visitId = `generated-visit-${patientId}-${caseTemplate.key}`;
    const appointmentId = `generated-appt-${patientId}`;
    const reviewId = `generated-review-${patientId}-${caseTemplate.key}`;
    const reportText = generatedReportText({ patientName, reportDate, caseTemplate, seed });

    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, 'PATIENT', ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email`,
    ).run(patientUserId, patientName, email, MOCK_PASSWORD_HASH, timestamp);
    db.prepare(
      `INSERT INTO patient_record_links (user_id, patient_record_id, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET patient_record_id = excluded.patient_record_id, updated_at = excluded.updated_at`,
    ).run(patientUserId, patientId, timestamp);

    assignDoctorToPatient({ doctorId, patientRecordId: patientId, patientUserId, source: "generated_all_patient_mock", notes: "Generated varied mock data for every patient record." });

    await runQuery(
      `MATCH (p:Patient {id: $patientId})
       SET p.name = coalesce(p.name, $name),
           p.age = coalesce(p.age, $age),
           p.risk = coalesce(p.risk, $risk),
           p.signals = $signals
       MERGE (v:Visit {id: $visitId})
       SET v.start = $visitStart, v.end = $visitEnd, v.type = $visitType, v.title = $visitTitle, v.description = $visitDescription, v.mock = true
       MERGE (p)-[:HAD_VISIT]->(v)
       WITH p
       UNWIND $conditions AS code
       MERGE (c:Condition {code: code})
       MERGE (p)-[:HAS_CONDITION]->(c)`,
      {
        patientId,
        name: patientName,
        age: patient.age ?? 40 + (seed % 45),
        risk: patient.risk ?? Math.min(0.95, 0.2 + (seed % 70) / 100),
        signals: caseTemplate.signals,
        visitId,
        visitStart,
        visitEnd,
        visitType: caseTemplate.visitType,
        visitTitle: caseTemplate.visitTitle,
        visitDescription: caseTemplate.assessment,
        conditions: caseTemplate.conditions,
      },
    );

    const storedName = `${reportId}.txt`;
    const storagePath = path.join(MOCK_ROOT, storedName);
    fs.writeFileSync(storagePath, reportText, "utf8");
    db.prepare(
      `INSERT INTO patient_documents
        (id, user_id, file_name, stored_name, mime_type, file_size, status, extraction_error, storage_path, extracted_text, report_date,
         extraction_version, parser_version, report_version, interpretation_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'application/pdf', ?, 'processed', NULL, ?, ?, ?, 1, 1, 1, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET extracted_text = excluded.extracted_text, report_date = excluded.report_date, updated_at = excluded.updated_at`,
    ).run(reportId, patientUserId, `${caseTemplate.reportName}_${patientId}.pdf`, storedName, Buffer.byteLength(reportText), storagePath, reportText, reportDate, timestamp, timestamp);
    db.prepare("DELETE FROM document_chunks WHERE document_id = ?").run(reportId);
    chunksFor(reportText).forEach((chunk, index) => {
      db.prepare(`INSERT INTO document_chunks (id, document_id, chunk_index, content, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(`${reportId}-chunk-${index}`, reportId, index, chunk, timestamp);
    });
    db.prepare("DELETE FROM lab_observations WHERE document_id = ?").run(reportId);
    extractObservations(reportText, reportDate).forEach((obs, index) => {
      db.prepare(
        `INSERT INTO lab_observations
          (id, document_id, user_id, test_name, value_text, numeric_value, unit, reference_range, abnormal_flag, observed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(`${reportId}-obs-${index}`, reportId, patientUserId, obs.testName, obs.valueText, Number.isFinite(obs.numericValue) ? obs.numericValue : null, obs.unit, obs.referenceRange, obs.abnormalFlag, obs.observedAt, timestamp);
    });
    reports += 1;

    db.prepare(
      `INSERT INTO visits (id, doctor_id, patient_user_id, patient_record_id, appointment_id, reason, status, started_at, ended_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, 'completed', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET reason = excluded.reason, started_at = excluded.started_at, ended_at = excluded.ended_at, updated_at = excluded.updated_at`,
    ).run(visitId, doctorId, patientUserId, patientId, caseTemplate.visitTitle, visitStart, visitEnd, timestamp, timestamp);
    visits += 1;

    db.prepare(
      `INSERT INTO appointments (id, doctor_id, patient_user_id, patient_record_id, slot_start, slot_end, status, reason, created_by_role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'booked', ?, 'DOCTOR', ?, ?)
       ON CONFLICT(id) DO UPDATE SET slot_start = excluded.slot_start, slot_end = excluded.slot_end, reason = excluded.reason, updated_at = excluded.updated_at`,
    ).run(appointmentId, doctorId, patientUserId, patientId, appointmentStart, appointmentEnd, `${caseTemplate.visitTitle} follow-up`, timestamp, timestamp);
    appointments += 1;

    db.prepare(
      `INSERT INTO patient_reviews
        (id, doctor_id, patient_user_id, patient_record_id, visit_id, appointment_id, title, summary, assessment, plan, follow_up, revisit_recommended, status, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'signed', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET summary = excluded.summary, assessment = excluded.assessment, plan = excluded.plan, follow_up = excluded.follow_up, updated_at = excluded.updated_at`,
    ).run(
      reviewId,
      doctorId,
      patientUserId,
      patientId,
      visitId,
      appointmentId,
      caseTemplate.reviewTitle,
      `${patientName} has a generated varied chart context for ${caseTemplate.visitTitle.toLowerCase()}.`,
      caseTemplate.assessment,
      caseTemplate.plan,
      `Follow up after ${caseTemplate.reportName.replace(/_/g, " ").toLowerCase()} review; repeat relevant labs as clinically appropriate.`,
      caseTemplate.key,
      timestamp,
      timestamp,
    );
    reviews += 1;
  }

  return { patients: patients.length, reports, visits, appointments, reviews, files: listMockClinicalCsvFiles(), firstPatientId: patients[0]?.id ? String(patients[0].id) : null };
}
