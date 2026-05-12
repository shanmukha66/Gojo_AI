import crypto from "crypto";
import { getDb } from "./db";
import { recordAiReward } from "./rlMetrics";
import { recordAuditEvent } from "./audit";

export function recordAiFeedback(input: {
  actorRole: "doctor" | "patient";
  actorUserId: string;
  routeKind: string;
  chatId?: string | null;
  messageId?: string | null;
  rating: "useful" | "too_vague" | "unsafe" | "missing_evidence" | "too_short";
  reason?: string | null;
  answerText?: string | null;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ai_feedback_events (id, actor_role, actor_user_id, route_kind, chat_id, message_id, rating, reason, answer_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), input.actorRole, input.actorUserId, input.routeKind, input.chatId ?? null, input.messageId ?? null, input.rating, input.reason ?? null, input.answerText ?? null, now);

  const rewardByRating = {
    useful: 1,
    too_vague: -0.35,
    unsafe: -1,
    missing_evidence: -0.55,
    too_short: -0.25,
  }[input.rating];

  recordAiReward({
    actorRole: input.actorRole,
    routeKind: input.routeKind,
    actionKey: `feedback:${input.rating}`,
    fallback: false,
    evidenceCount: input.rating === "missing_evidence" ? 0 : 1,
    caution: input.rating === "unsafe" ? "high" : "moderate",
    answerLength: input.answerText?.length || 0,
    model: "user-feedback",
    extraReward: rewardByRating,
  });
  recordAuditEvent({ actorUserId: input.actorUserId, actorRole: input.actorRole.toUpperCase(), action: "ai_feedback.create", entityType: "ai_answer", entityId: input.messageId || input.chatId || null, metadata: { routeKind: input.routeKind, rating: input.rating } });
}

export function listFeedbackMetrics() {
  const db = getDb();
  return db.prepare(
    `SELECT actor_role AS actorRole, route_kind AS routeKind, rating, COUNT(*) AS count, MAX(created_at) AS latestAt
     FROM ai_feedback_events
     GROUP BY actor_role, route_kind, rating
     ORDER BY latestAt DESC
     LIMIT 40`,
  ).all();
}
