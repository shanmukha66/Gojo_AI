import crypto from "crypto";
import { getDb } from "./db";

function nowIso() {
  return new Date().toISOString();
}

export type JobStatus = "queued" | "running" | "completed" | "failed";

export type AppJob = {
  id: string;
  kind: string;
  status: JobStatus;
  payloadJson: string;
  resultJson: string | null;
  errorText: string | null;
  attempts: number;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  ownerUserId: string | null;
};

function mapJob(row: {
  id: string;
  kind: string;
  status: JobStatus;
  payload_json: string;
  result_json: string | null;
  error_text: string | null;
  attempts: number;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  owner_user_id: string | null;
}): AppJob {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    payloadJson: row.payload_json,
    resultJson: row.result_json,
    errorText: row.error_text,
    attempts: Number(row.attempts),
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownerUserId: row.owner_user_id,
  };
}

export function enqueueJob(input: {
  kind: string;
  payload: Record<string, unknown>;
  ownerUserId?: string | null;
  scheduledAt?: string;
}) {
  const db = getDb();
  const now = nowIso();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO jobs
      (id, kind, status, payload_json, result_json, error_text, attempts, scheduled_at, started_at, finished_at, created_at, updated_at, owner_user_id)
     VALUES (?, ?, 'queued', ?, NULL, NULL, 0, ?, NULL, NULL, ?, ?, ?)`,
  ).run(
    id,
    input.kind,
    JSON.stringify(input.payload),
    input.scheduledAt ?? now,
    now,
    now,
    input.ownerUserId ?? null,
  );
  return getJob(id);
}

export function getJob(id: string) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, kind, status, payload_json, result_json, error_text, attempts, scheduled_at, started_at, finished_at, created_at, updated_at, owner_user_id
       FROM jobs WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        kind: string;
        status: JobStatus;
        payload_json: string;
        result_json: string | null;
        error_text: string | null;
        attempts: number;
        scheduled_at: string;
        started_at: string | null;
        finished_at: string | null;
        created_at: string;
        updated_at: string;
        owner_user_id: string | null;
      }
    | undefined;
  return row ? mapJob(row) : null;
}

export function listJobsForOwner(ownerUserId: string, kinds?: string[]) {
  const db = getDb();
  const rows = (kinds && kinds.length > 0
    ? db
        .prepare(
          `SELECT id, kind, status, payload_json, result_json, error_text, attempts, scheduled_at, started_at, finished_at, created_at, updated_at, owner_user_id
           FROM jobs
           WHERE owner_user_id = ? AND kind IN (${kinds.map(() => "?").join(",")})
           ORDER BY created_at DESC`,
        )
        .all(ownerUserId, ...kinds)
    : db
        .prepare(
          `SELECT id, kind, status, payload_json, result_json, error_text, attempts, scheduled_at, started_at, finished_at, created_at, updated_at, owner_user_id
           FROM jobs
           WHERE owner_user_id = ?
           ORDER BY created_at DESC`,
        )
        .all(ownerUserId)) as Array<{
    id: string;
    kind: string;
    status: JobStatus;
    payload_json: string;
    result_json: string | null;
    error_text: string | null;
    attempts: number;
    scheduled_at: string;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
    updated_at: string;
    owner_user_id: string | null;
  }>;
  return rows.map(mapJob);
}

export function markJobRunning(id: string) {
  const db = getDb();
  const now = nowIso();
  db.prepare(
    `UPDATE jobs
     SET status = 'running', attempts = attempts + 1, started_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(now, now, id);
  return getJob(id);
}

export function markJobCompleted(id: string, result: Record<string, unknown>) {
  const db = getDb();
  const now = nowIso();
  db.prepare(
    `UPDATE jobs
     SET status = 'completed', result_json = ?, error_text = NULL, finished_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(JSON.stringify(result), now, now, id);
  return getJob(id);
}

export function markJobFailed(id: string, errorText: string) {
  const db = getDb();
  const now = nowIso();
  db.prepare(
    `UPDATE jobs
     SET status = 'failed', error_text = ?, finished_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(errorText, now, now, id);
  return getJob(id);
}
