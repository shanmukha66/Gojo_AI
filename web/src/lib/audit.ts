import crypto from "crypto";
import { getDb } from "./db";

export function recordAuditEvent(input: {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: unknown;
}) {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_events (id, actor_user_id, actor_role, action, entity_type, entity_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    input.actorUserId ?? null,
    input.actorRole ?? null,
    input.action,
    input.entityType ?? null,
    input.entityId ?? null,
    JSON.stringify(input.metadata ?? {}),
    new Date().toISOString(),
  );
}
