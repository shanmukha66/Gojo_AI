import { getDb } from "./db";
import { runQuery } from "./neo4j";
import { getConceptMap } from "./omop";
import { getUserIdsForPatientRecord } from "./patientRecordLink";

export type GraphEvidencePath = {
  key: string;
  title: string;
  description: string;
  path: string[];
  sourceCategory: string;
  at: string | null;
};

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export async function syncExpandedKnowledgeGraphForPatient(patientId: string, doctorId?: string) {
  const db = getDb();
  const userIds = await getUserIdsForPatientRecord(patientId);
  const conceptMap = await getConceptMap();

  const patientRows = await runQuery<{ p: { id: string; name?: string; age?: number; gender?: string; risk?: number; signals?: string[] } }>(
    `MATCH (p:Patient {id: $id}) RETURN p { .* } AS p LIMIT 1`,
    { id: patientId },
  );
  const patient = patientRows[0]?.p;
  if (!patient) return;

  const visits = await runQuery<{ v: { id?: string; start?: string; end?: string; type?: string } }>(
    `MATCH (p:Patient {id: $id})-[:HAD_VISIT]->(v:Visit)
     RETURN v { .* } AS v
     ORDER BY v.start DESC
     LIMIT 40`,
    { id: patientId },
  );

  const documents = userIds.length
    ? (db
        .prepare(
          `SELECT id, user_id, file_name, mime_type, status, report_date, created_at, updated_at
           FROM patient_documents
           WHERE user_id IN (${userIds.map(() => "?").join(",")})
           ORDER BY created_at DESC`,
        )
        .all(...userIds) as Array<{
        id: string;
        user_id: string;
        file_name: string;
        mime_type: string;
        status: string;
        report_date: string | null;
        created_at: string;
        updated_at: string;
      }>)
    : [];

  const observations = userIds.length
    ? (db
        .prepare(
          `SELECT id, document_id, user_id, test_name, value_text, numeric_value, unit, reference_range, abnormal_flag, observed_at, created_at
           FROM lab_observations
           WHERE user_id IN (${userIds.map(() => "?").join(",")})
           ORDER BY observed_at DESC, created_at DESC`,
        )
        .all(...userIds) as Array<{
        id: string;
        document_id: string;
        user_id: string;
        test_name: string;
        value_text: string | null;
        numeric_value: number | null;
        unit: string | null;
        reference_range: string | null;
        abnormal_flag: string | null;
        observed_at: string | null;
        created_at: string;
      }>)
    : [];

  const appointments = userIds.length
    ? (db
        .prepare(
          `SELECT a.id, a.doctor_id, a.patient_record_id, a.slot_start, a.slot_end, a.status, a.reason, a.created_at, u.name AS doctor_name
           FROM appointments a
           LEFT JOIN users u ON u.id = a.doctor_id
           WHERE a.patient_record_id = ? OR a.patient_user_id IN (${userIds.map(() => "?").join(",")})
           ORDER BY a.slot_start DESC`,
        )
        .all(patientId, ...userIds) as Array<{
        id: string;
        doctor_id: string | null;
        patient_record_id: string | null;
        slot_start: string;
        slot_end: string;
        status: string;
        reason: string;
        created_at: string;
        doctor_name: string | null;
      }>)
    : [];

  const patientMemos = doctorId
    ? (db
        .prepare(
          `SELECT id, doctor_id, patient_id, title, body, status, tags, created_at, updated_at
           FROM patient_memos
           WHERE doctor_id = ? AND patient_id = ?
           ORDER BY updated_at DESC`,
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
      }>)
    : [];

  const doctorMemos = doctorId
    ? (db
        .prepare(
          `SELECT id, doctor_id, title, body, type, tags, created_at, updated_at
           FROM doctor_memos
           WHERE doctor_id = ?
           ORDER BY updated_at DESC
           LIMIT 8`,
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
      }>)
    : [];

  const doctorRows = doctorId
    ? (db
        .prepare("SELECT id, name, email FROM users WHERE id = ?")
        .all(doctorId) as Array<{ id: string; name: string | null; email: string }>)
    : [];

  await runQuery(
    `
    MERGE (p:Patient {id: $patient.id})
    SET p.name = coalesce($patient.name, p.name),
        p.age = coalesce($patient.age, p.age),
        p.gender = coalesce($patient.gender, p.gender),
        p.risk = coalesce($patient.risk, p.risk),
        p.signals = coalesce($patient.signals, p.signals)
    `,
    { patient },
  );

  if (doctorRows.length) {
    await runQuery(
      `
      UNWIND $doctors AS doctor
      MERGE (d:Doctor {id: doctor.id})
      SET d.name = coalesce(doctor.name, d.name),
          d.email = coalesce(doctor.email, d.email)
      `,
      { doctors: doctorRows },
    );
  }

  if (documents.length) {
    await runQuery(
      `
      UNWIND $documents AS document
      MATCH (p:Patient {id: $patientId})
      MERGE (d:PatientDocument {id: document.id})
      SET d.userId = document.user_id,
          d.fileName = document.file_name,
          d.mimeType = document.mime_type,
          d.status = document.status,
          d.reportDate = document.report_date,
          d.createdAt = document.created_at,
          d.updatedAt = document.updated_at
      MERGE (p)-[:HAS_DOCUMENT]->(d)
      `,
      { patientId, documents },
    );
  }

  if (observations.length) {
    await runQuery(
      `
      UNWIND $observations AS observation
      MATCH (p:Patient {id: $patientId})
      MATCH (d:PatientDocument {id: observation.document_id})
      MERGE (l:LabObservation {id: observation.id})
      SET l.testName = observation.test_name,
          l.valueText = observation.value_text,
          l.numericValue = observation.numeric_value,
          l.unit = observation.unit,
          l.referenceRange = observation.reference_range,
          l.abnormalFlag = observation.abnormal_flag,
          l.observedAt = observation.observed_at,
          l.createdAt = observation.created_at
      MERGE (d)-[:HAS_OBSERVATION]->(l)
      MERGE (p)-[:HAS_LAB_OBSERVATION]->(l)
      `,
      { patientId, observations },
    );
  }

  if (appointments.length) {
    await runQuery(
      `
      UNWIND $appointments AS appointment
      MATCH (p:Patient {id: $patientId})
      MERGE (a:Appointment {id: appointment.id})
      SET a.slotStart = appointment.slot_start,
          a.slotEnd = appointment.slot_end,
          a.status = appointment.status,
          a.reason = appointment.reason,
          a.createdAt = appointment.created_at
      MERGE (p)-[:HAS_APPOINTMENT]->(a)
      FOREACH (_ IN CASE WHEN appointment.doctor_id IS NULL THEN [] ELSE [1] END |
        MERGE (d:Doctor {id: appointment.doctor_id})
        SET d.name = coalesce(appointment.doctor_name, d.name)
        MERGE (d)-[:ATTENDS_APPOINTMENT]->(a)
      )
      `,
      { patientId, appointments },
    );
  }

  if (patientMemos.length) {
    await runQuery(
      `
      UNWIND $memos AS memo
      MATCH (p:Patient {id: $patientId})
      MERGE (m:PatientMemo {id: memo.id})
      SET m.title = memo.title,
          m.body = memo.body,
          m.status = memo.status,
          m.tags = memo.tags,
          m.createdAt = memo.created_at,
          m.updatedAt = memo.updated_at
      MERGE (p)-[:HAS_MEMO]->(m)
      FOREACH (_ IN CASE WHEN memo.doctor_id IS NULL THEN [] ELSE [1] END |
        MERGE (d:Doctor {id: memo.doctor_id})
        MERGE (d)-[:AUTHORED_MEMO]->(m)
      )
      MERGE (m)-[:ABOUT_PATIENT]->(p)
      `,
      { patientId, memos: patientMemos },
    );
  }

  if (doctorMemos.length) {
    await runQuery(
      `
      UNWIND $memos AS memo
      MERGE (m:DoctorMemo {id: memo.id})
      SET m.title = memo.title,
          m.body = memo.body,
          m.type = memo.type,
          m.tags = memo.tags,
          m.createdAt = memo.created_at,
          m.updatedAt = memo.updated_at
      MERGE (d:Doctor {id: memo.doctor_id})
      MERGE (d)-[:OWNS_MEMO]->(m)
      `,
      { memos: doctorMemos },
    );
  }

  const visitPayload = visits.map((row) => {
    const visit = row.v || {};
    const typeCode = visit.type ? String(visit.type) : null;
    const typeName = typeCode ? conceptMap.get(typeCode)?.name || null : null;
    const label = typeName || "Clinical visit";
    return {
      id: visit.id || null,
      start: visit.start || null,
      end: visit.end || null,
      typeCode,
      typeName,
      admissionId: visit.id ? `${visit.id}:admission` : null,
      dischargeId: visit.id ? `${visit.id}:discharge` : null,
      admissionTitle: `Admission marker · ${label}`,
      dischargeTitle: `Discharge marker · ${label}`,
    };
  });

  if (visitPayload.length) {
    await runQuery(
      `
      UNWIND $visits AS visit
      MATCH (p:Patient {id: $patientId})
      MATCH (v:Visit {id: visit.id})
      MERGE (p)-[:HAD_VISIT]->(v)
      FOREACH (_ IN CASE WHEN visit.admissionId IS NULL THEN [] ELSE [1] END |
        MERGE (ad:CareEvent {id: visit.admissionId})
        SET ad.kind = 'admission',
            ad.at = visit.start,
            ad.title = visit.admissionTitle,
            ad.visitTypeCode = visit.typeCode,
            ad.visitTypeName = visit.typeName
        MERGE (v)-[:HAS_ADMISSION_EVENT]->(ad)
      )
      FOREACH (_ IN CASE WHEN visit.dischargeId IS NULL THEN [] ELSE [1] END |
        MERGE (dis:CareEvent {id: visit.dischargeId})
        SET dis.kind = 'discharge',
            dis.at = coalesce(visit.end, visit.start),
            dis.title = visit.dischargeTitle,
            dis.visitTypeCode = visit.typeCode,
            dis.visitTypeName = visit.typeName
        MERGE (v)-[:HAS_DISCHARGE_EVENT]->(dis)
      )
      `,
      { patientId, visits: visitPayload.filter((visit) => visit.id) },
    );

    await runQuery(
      `
      MATCH (:Visit)-[:HAS_ADMISSION_EVENT]->(ad:CareEvent)
      MATCH (:Visit)-[:HAS_DISCHARGE_EVENT]->(dis:CareEvent)
      WHERE split(ad.id, ':')[0] = split(dis.id, ':')[0]
      MERGE (ad)-[:LEADS_TO]->(dis)
      `,
    );
  }
}

export async function getGraphEvidencePaths(patientId: string): Promise<GraphEvidencePath[]> {
  const paths: GraphEvidencePath[] = [];

  const documentPaths = await runQuery<{
    documentId: string;
    fileName: string;
    reportDate?: string;
    observationName?: string;
    abnormalFlag?: string;
  }>(
    `
    MATCH (p:Patient {id: $patientId})-[:HAS_DOCUMENT]->(d:PatientDocument)
    OPTIONAL MATCH (d)-[:HAS_OBSERVATION]->(l:LabObservation)
    RETURN d.id AS documentId,
           d.fileName AS fileName,
           d.reportDate AS reportDate,
           l.testName AS observationName,
           l.abnormalFlag AS abnormalFlag
    ORDER BY d.reportDate DESC, d.createdAt DESC
    LIMIT 6
    `,
    { patientId },
  );

  paths.push(
    ...documentPaths.map((row, index) => ({
      key: `document-${row.documentId}-${index}`,
      title: row.fileName || "Uploaded report",
      description: row.observationName
        ? `${row.observationName}${row.abnormalFlag ? ` (${row.abnormalFlag})` : ""} was extracted from this document and linked back to the patient graph.`
        : "This uploaded report is linked directly to the patient and can ground report-aware retrieval.",
      path: uniqueStrings([
        `Patient ${patientId}`,
        row.fileName ? `Document ${row.fileName}` : "Document",
        row.observationName ? `Observation ${row.observationName}` : null,
      ]),
      sourceCategory: "Patient → Document → Observation",
      at: row.reportDate || null,
    })),
  );

  const appointmentPaths = await runQuery<{
    appointmentId: string;
    slotStart?: string;
    status?: string;
    reason?: string;
    doctorName?: string;
  }>(
    `
    MATCH (p:Patient {id: $patientId})-[:HAS_APPOINTMENT]->(a:Appointment)
    OPTIONAL MATCH (d:Doctor)-[:ATTENDS_APPOINTMENT]->(a)
    RETURN a.id AS appointmentId,
           a.slotStart AS slotStart,
           a.status AS status,
           a.reason AS reason,
           d.name AS doctorName
    ORDER BY a.slotStart DESC
    LIMIT 4
    `,
    { patientId },
  );

  paths.push(
    ...appointmentPaths.map((row, index) => ({
      key: `appointment-${row.appointmentId}-${index}`,
      title: row.doctorName ? `Appointment with ${row.doctorName}` : "Appointment event",
      description: `${row.status || "unknown"} appointment${row.reason ? ` for "${row.reason}"` : ""} is linked in the graph so scheduling context can be retrieved alongside clinical evidence.`,
      path: uniqueStrings([`Patient ${patientId}`, row.doctorName ? `Doctor ${row.doctorName}` : "Doctor", "Appointment"]),
      sourceCategory: "Patient → Appointment ← Doctor",
      at: row.slotStart || null,
    })),
  );

  const memoPaths = await runQuery<{
    memoId: string;
    title?: string;
    doctorName?: string;
    updatedAt?: string;
    kind?: string;
  }>(
    `
    MATCH (p:Patient {id: $patientId})<-[:ABOUT_PATIENT]-(m:PatientMemo)
    OPTIONAL MATCH (d:Doctor)-[:AUTHORED_MEMO]->(m)
    RETURN m.id AS memoId,
           m.title AS title,
           d.name AS doctorName,
           m.updatedAt AS updatedAt,
           m.status AS kind
    ORDER BY m.updatedAt DESC
    LIMIT 4
    `,
    { patientId },
  );

  paths.push(
    ...memoPaths.map((row, index) => ({
      key: `memo-${row.memoId}-${index}`,
      title: row.title || "Clinical memo",
      description: `${row.doctorName ? `${row.doctorName} authored` : "Doctor-authored"} memo${row.kind ? ` with status ${row.kind}` : ""} is connected to this patient for longitudinal review.`,
      path: uniqueStrings([row.doctorName ? `Doctor ${row.doctorName}` : "Doctor", row.title ? `Memo ${row.title}` : "Memo", `Patient ${patientId}`]),
      sourceCategory: "Doctor → Memo → Patient",
      at: row.updatedAt || null,
    })),
  );

  const carePaths = await runQuery<{
    visitId: string;
    visitTypeName?: string;
    admissionAt?: string;
    dischargeAt?: string;
  }>(
    `
    MATCH (p:Patient {id: $patientId})-[:HAD_VISIT]->(v:Visit)
    OPTIONAL MATCH (v)-[:HAS_ADMISSION_EVENT]->(ad:CareEvent {kind: 'admission'})
    OPTIONAL MATCH (v)-[:HAS_DISCHARGE_EVENT]->(dis:CareEvent {kind: 'discharge'})
    RETURN v.id AS visitId,
           coalesce(ad.visitTypeName, dis.visitTypeName) AS visitTypeName,
           ad.at AS admissionAt,
           dis.at AS dischargeAt
    ORDER BY coalesce(ad.at, dis.at, v.start) DESC
    LIMIT 4
    `,
    { patientId },
  );

  paths.push(
    ...carePaths.map((row, index) => ({
      key: `care-${row.visitId}-${index}`,
      title: row.visitTypeName || "Visit episode",
      description: row.dischargeAt
        ? "The graph preserves the visit episode as admission-to-discharge flow so acute-care context is easier to inspect."
        : "The graph preserves the visit episode with admission-style structure for higher-acuity review.",
      path: uniqueStrings([`Patient ${patientId}`, row.visitTypeName ? `Visit ${row.visitTypeName}` : "Visit", "Admission", row.dischargeAt ? "Discharge" : null]),
      sourceCategory: "Visit → Admission → Discharge",
      at: row.admissionAt || row.dischargeAt || null,
    })),
  );

  return paths
    .sort((a, b) => {
      const aTime = a.at ? new Date(a.at).valueOf() : 0;
      const bTime = b.at ? new Date(b.at).valueOf() : 0;
      return bTime - aTime;
    })
    .slice(0, 10);
}
