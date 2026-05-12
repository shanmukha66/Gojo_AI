import crypto from "crypto";
import { getDb } from "./db";

export type GroundTruthActorRole = "doctor" | "patient";

export type GroundTruthMemoryMatch = {
  id: string;
  actorRole: GroundTruthActorRole;
  routeKind: string;
  scopeKey: string | null;
  question: string;
  answer: string;
  evidenceJson: string;
  relevanceScore: number;
  caution: string | null;
  sourceMode: string | null;
  model: string | null;
  reuseCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const STOP_WORDS = new Set([
  "what",
  "when",
  "where",
  "which",
  "with",
  "from",
  "this",
  "that",
  "have",
  "does",
  "should",
  "could",
  "would",
  "about",
  "into",
  "after",
  "before",
  "there",
  "their",
  "patient",
  "doctor",
  "please",
  "tell",
  "explain",
]);

function nowIso() {
  return new Date().toISOString();
}

export function normalizeQuestion(question: string) {
  return question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(question: string) {
  return normalizeQuestion(question)
    .split(" ")
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function jaccardSimilarity(a: string, b: string) {
  const aTokens = new Set(tokens(a));
  const bTokens = new Set(tokens(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }
  const union = new Set([...aTokens, ...bTokens]).size;
  return union ? intersection / union : 0;
}

export function findGroundTruthMemory(input: {
  actorRole: GroundTruthActorRole;
  routeKind: string;
  scopeKey?: string | null;
  question: string;
  threshold?: number;
}) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, actor_role AS actorRole, route_kind AS routeKind, scope_key AS scopeKey,
              question, normalized_question AS normalizedQuestion, answer, evidence_json AS evidenceJson,
              relevance_score AS relevanceScore, caution, source_mode AS sourceMode, model,
              reuse_count AS reuseCount, last_used_at AS lastUsedAt, created_at AS createdAt, updated_at AS updatedAt
       FROM ground_truth_memories
       WHERE actor_role = ? AND route_kind = ? AND COALESCE(scope_key, '') = COALESCE(?, '')
       ORDER BY updated_at DESC
       LIMIT 80`,
    )
    .all(input.actorRole, input.routeKind, input.scopeKey ?? null) as Array<GroundTruthMemoryMatch & { normalizedQuestion: string }>;

  const threshold = input.threshold ?? 0.78;
  const exact = normalizeQuestion(input.question);
  const ranked = rows
    .map((row) => {
      const isExact = row.normalizedQuestion === exact;
      return { ...row, isExact, relevanceScore: isExact ? 1 : jaccardSimilarity(input.question, row.question) };
    })
    .filter((row) => {
      // Do not let older one-line/generic answers become permanent "ground truth".
      // If a stored answer is too short, generate a fresh richer answer and overwrite it.
      const enoughDetail = row.answer.trim().length >= 320;
      return enoughDetail && row.relevanceScore >= threshold;
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  const match = ranked[0];
  if (!match) return null;

  const now = nowIso();
  db.prepare(`UPDATE ground_truth_memories SET reuse_count = reuse_count + 1, last_used_at = ?, updated_at = ? WHERE id = ?`).run(now, now, match.id);
  db.prepare(
    `INSERT INTO ground_truth_relevance_events (id, memory_id, actor_role, route_kind, scope_key, question, relevance_score, reused, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(crypto.randomUUID(), match.id, input.actorRole, input.routeKind, input.scopeKey ?? null, input.question, match.relevanceScore, now);

  return match;
}

export function saveGroundTruthMemory(input: {
  actorRole: GroundTruthActorRole;
  routeKind: string;
  scopeKey?: string | null;
  question: string;
  answer: string;
  evidence: unknown[];
  relevanceScore?: number;
  caution?: string | null;
  sourceMode?: string | null;
  model?: string | null;
  fallback?: boolean;
}) {
  const answer = input.answer.trim();
  const question = input.question.trim();
  if (!question || !answer) return null;

  const db = getDb();
  const normalized = normalizeQuestion(question);
  const existing = db
    .prepare(
      `SELECT id FROM ground_truth_memories
       WHERE actor_role = ? AND route_kind = ? AND COALESCE(scope_key, '') = COALESCE(?, '') AND normalized_question = ?`,
    )
    .get(input.actorRole, input.routeKind, input.scopeKey ?? null, normalized) as { id: string } | undefined;
  const now = nowIso();

  if (existing) {
    db.prepare(
      `UPDATE ground_truth_memories
       SET answer = ?, evidence_json = ?, relevance_score = ?, caution = ?, source_mode = ?, model = ?, fallback = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      answer,
      JSON.stringify(input.evidence || []),
      input.relevanceScore ?? 1,
      input.caution ?? null,
      input.sourceMode ?? null,
      input.model ?? null,
      input.fallback ? 1 : 0,
      now,
      existing.id,
    );
    return existing.id;
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ground_truth_memories
      (id, actor_role, route_kind, scope_key, question, normalized_question, answer, evidence_json, relevance_score, caution, source_mode, model, fallback, reuse_count, last_used_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
  ).run(
    id,
    input.actorRole,
    input.routeKind,
    input.scopeKey ?? null,
    question,
    normalized,
    answer,
    JSON.stringify(input.evidence || []),
    input.relevanceScore ?? 1,
    input.caution ?? null,
    input.sourceMode ?? null,
    input.model ?? null,
    input.fallback ? 1 : 0,
    now,
    now,
  );
  return id;
}
