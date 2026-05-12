import { getDb } from "./db";
import { runQuery } from "./neo4j";

function nowIso() {
  return new Date().toISOString();
}

export async function getPatientRecordLink(userId: string) {
  const db = getDb();
  const row = db
    .prepare("SELECT patient_record_id, updated_at FROM patient_record_links WHERE user_id = ?")
    .get(userId) as { patient_record_id: string; updated_at: string } | undefined;

  if (!row) return null;
  return {
    patientRecordId: row.patient_record_id,
    updatedAt: row.updated_at,
  };
}

export async function setPatientRecordLink(userId: string, patientRecordId: string) {
  const db = getDb();
  const updatedAt = nowIso();
  db.prepare(
    `INSERT INTO patient_record_links (user_id, patient_record_id, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET patient_record_id = excluded.patient_record_id, updated_at = excluded.updated_at`
  ).run(userId, patientRecordId, updatedAt);

  return {
    patientRecordId,
    updatedAt,
  };
}

export async function getOrCreatePatientRecordLink(userId: string) {
  const existing = await getPatientRecordLink(userId);
  if (existing) return existing;

  const results = await runQuery<{ p: { id: string } }>(
    `MATCH (p:Patient)
     WHERE p.id IS NOT NULL AND p.id <> "undefined"
     RETURN p { .id } AS p
     ORDER BY toInteger(p.id) ASC
     LIMIT 1`
  );

  const patientRecordId = results[0]?.p?.id;
  if (!patientRecordId) {
    throw new Error("No patient records available to link.");
  }

  return setPatientRecordLink(userId, String(patientRecordId));
}

export async function getUserIdsForPatientRecord(patientRecordId: string) {
  const db = getDb();
  const rows = db
    .prepare("SELECT user_id FROM patient_record_links WHERE patient_record_id = ?")
    .all(patientRecordId) as Array<{ user_id: string }>;
  return rows.map((row) => row.user_id);
}
