import { randomUUID } from "crypto";
import { getDb } from "./db";

export type AiRewardInput = {
  actorRole: "doctor" | "patient" | "system";
  routeKind: string;
  actionKey: string;
  fallback: boolean;
  cacheHit?: boolean;
  evidenceCount?: number;
  caution?: string;
  answerLength?: number;
  model?: string;
  extraReward?: number;
};

function now() {
  return new Date().toISOString();
}

function bandEvidence(count: number) {
  if (count >= 5) return "evidence-rich";
  if (count >= 2) return "evidence-some";
  return "evidence-low";
}

export function stateKeyForAi(input: AiRewardInput) {
  return [input.actorRole, input.routeKind, bandEvidence(input.evidenceCount ?? 0), input.caution || "unknown"].join(":");
}

export function computeAiReward(input: AiRewardInput) {
  let reward = 0;
  const evidenceCount = input.evidenceCount ?? 0;
  if (!input.fallback) reward += 0.35;
  if (input.cacheHit) reward += 0.1;
  reward += Math.min(0.35, evidenceCount * 0.07);
  if (input.answerLength && input.answerLength >= 80 && input.answerLength <= 1800) reward += 0.1;
  if (input.caution === "high" || input.caution === "moderate") reward += 0.05;
  if (input.fallback && evidenceCount === 0) reward -= 0.2;
  reward += input.extraReward ?? 0;
  return Math.max(-1, Math.min(1, Number(reward.toFixed(4))));
}

export function recordAiReward(input: AiRewardInput) {
  const db = getDb();
  const reward = computeAiReward(input);
  const stateKey = stateKeyForAi(input);
  const timestamp = now();
  const metrics = {
    fallback: input.fallback,
    cacheHit: Boolean(input.cacheHit),
    evidenceCount: input.evidenceCount ?? 0,
    caution: input.caution ?? null,
    answerLength: input.answerLength ?? 0,
    model: input.model ?? null,
    extraReward: input.extraReward ?? 0,
  };

  db.prepare(
    `INSERT INTO ai_rl_events (id, actor_role, route_kind, state_key, action_key, reward, metrics_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), input.actorRole, input.routeKind, stateKey, input.actionKey, reward, JSON.stringify(metrics), timestamp);

  const existing = db
    .prepare(`SELECT q_value AS qValue, visits FROM ai_rl_q_values WHERE state_key = ? AND action_key = ?`)
    .get(stateKey, input.actionKey) as { qValue: number; visits: number } | undefined;
  const alpha = 0.25;
  const nextVisits = (existing?.visits ?? 0) + 1;
  const nextQ = existing ? existing.qValue + alpha * (reward - existing.qValue) : reward;

  db.prepare(
    `INSERT INTO ai_rl_q_values (state_key, action_key, q_value, visits, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(state_key, action_key) DO UPDATE SET
       q_value = excluded.q_value,
       visits = excluded.visits,
       updated_at = excluded.updated_at`
  ).run(stateKey, input.actionKey, nextQ, nextVisits, timestamp);

  return { reward, stateKey, actionKey: input.actionKey, qValue: nextQ, visits: nextVisits };
}
