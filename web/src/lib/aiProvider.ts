import crypto from "crypto";
import { randomUUID } from "crypto";
import { getDb } from "./db";
import { listFeedbackMetrics } from "./aiFeedback";

export type AiJsonCallInput = {
  routeKind: string;
  system: string;
  user: string;
  schemaName: string;
  schema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  cacheTtlSeconds?: number;
  modelTier?: "light" | "reasoning";
};

export type AiProviderResult<T> = {
  data: T;
  provider: "minimax" | "openai" | "cache";
  model: string;
  cacheHit: boolean;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

type MiniMaxResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
  base_resp?: { status_code?: number; status_msg?: string };
};

type OpenAIResponse = {
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

function now() {
  return new Date().toISOString();
}

function hashPayload(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function ttlSeconds(input?: number) {
  return input ?? Number(process.env.AI_CACHE_TTL_SECONDS || "86400");
}

function providerPreference() {
  return (process.env.AI_PROVIDER || "minimax").toLowerCase();
}

function allowOpenAiTextFallback() {
  return process.env.OPENAI_TEXT_FALLBACK === "true";
}

function selectMiniMaxModel(input: AiJsonCallInput) {
  if (input.modelTier === "reasoning") {
    return process.env.MINIMAX_REASONING_MODEL || process.env.MINIMAX_MODEL || "MiniMax-M2.7";
  }
  return process.env.MINIMAX_LIGHT_MODEL || process.env.MINIMAX_MODEL || "MiniMax-M2.5-highspeed";
}

function dailyTokenSoftLimitReached() {
  const limit = Number(process.env.AI_DAILY_TOKEN_SOFT_LIMIT || "0");
  if (!limit) return false;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = getDb()
    .prepare(`SELECT COALESCE(SUM(total_tokens), 0) AS tokens FROM ai_usage_logs WHERE provider = 'minimax' AND cache_hit = 0 AND created_at >= ?`)
    .get(since) as { tokens: number } | undefined;
  return (row?.tokens ?? 0) >= limit;
}

function cleanJsonText(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(cleanJsonText(text)) as T;
  } catch {
    return null;
  }
}

function cacheKey(input: AiJsonCallInput, provider: string, model: string) {
  const requestHash = hashPayload({
    provider,
    model,
    routeKind: input.routeKind,
    system: input.system,
    user: input.user,
    schemaName: input.schemaName,
    schema: input.schema ?? null,
  });
  return { key: `${provider}:${model}:${input.routeKind}:${requestHash}`, requestHash };
}

function readCache<T>(key: string): AiProviderResult<T> | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT cache_key, provider, model, response_json, usage_json, expires_at
       FROM ai_response_cache
       WHERE cache_key = ?`
    )
    .get(key) as
    | {
        provider: string;
        model: string;
        response_json: string;
        usage_json: string | null;
        expires_at: string;
      }
    | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  db.prepare(`UPDATE ai_response_cache SET hits = hits + 1, updated_at = ? WHERE cache_key = ?`).run(now(), key);
  return {
    data: JSON.parse(row.response_json) as T,
    provider: "cache",
    model: row.model,
    cacheHit: true,
    usage: row.usage_json ? JSON.parse(row.usage_json) : undefined,
  };
}

function writeCache<T>(input: {
  key: string;
  provider: string;
  model: string;
  routeKind: string;
  requestHash: string;
  data: T;
  usage?: AiProviderResult<T>["usage"];
  ttl: number;
}) {
  const timestamp = now();
  const expiresAt = new Date(Date.now() + input.ttl * 1000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO ai_response_cache
        (cache_key, provider, model, route_kind, request_hash, response_json, usage_json, hits, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
        response_json = excluded.response_json,
        usage_json = excluded.usage_json,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at`
    )
    .run(
      input.key,
      input.provider,
      input.model,
      input.routeKind,
      input.requestHash,
      JSON.stringify(input.data),
      input.usage ? JSON.stringify(input.usage) : null,
      expiresAt,
      timestamp,
      timestamp,
    );
}

function logUsage(input: {
  provider: string;
  model: string;
  routeKind: string;
  cacheHit: boolean;
  requestHash?: string;
  usage?: AiProviderResult<unknown>["usage"];
}) {
  getDb()
    .prepare(
      `INSERT INTO ai_usage_logs
        (id, provider, model, route_kind, cache_hit, prompt_tokens, completion_tokens, total_tokens, request_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      input.provider,
      input.model,
      input.routeKind,
      input.cacheHit ? 1 : 0,
      input.usage?.promptTokens ?? 0,
      input.usage?.completionTokens ?? 0,
      input.usage?.totalTokens ?? 0,
      input.requestHash ?? null,
      now(),
    );
}

async function callMiniMax<T>(input: AiJsonCallInput): Promise<AiProviderResult<T> | null> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return null;

  if (dailyTokenSoftLimitReached()) return null;

  const model = selectMiniMaxModel(input);
  const baseUrl = process.env.MINIMAX_BASE_URL || "https://api.minimax.io/v1/text/chatcompletion_v2";
  const prompt = `${input.user}\n\nReturn only valid JSON for schema ${input.schemaName}. Do not add markdown.`;
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", name: "GOJO Health App", content: input.system },
        { role: "user", name: "user", content: prompt },
      ],
      temperature: input.temperature ?? 0.2,
      max_completion_tokens: input.maxTokens ?? 1200,
      stream: false,
      mask_sensitive_info: false,
    }),
  });

  if (!res.ok) return null;
  const json = (await res.json()) as MiniMaxResponse;
  const statusCode = json.base_resp?.status_code ?? 0;
  if (statusCode !== 0) return null;

  const text = json.choices?.[0]?.message?.content;
  if (!text) return null;
  const data = parseJson<T>(text);
  if (!data) return null;

  return {
    data,
    provider: "minimax",
    model: json.model || model,
    cacheHit: false,
    usage: {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
      totalTokens: json.usage?.total_tokens ?? 0,
    },
  };
}

async function callOpenAI<T>(input: AiJsonCallInput): Promise<AiProviderResult<T> | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL || "gpt-5.4";
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: input.system }] },
        { role: "user", content: [{ type: "input_text", text: input.user }] },
      ],
      text: input.schema
        ? {
            format: {
              type: "json_schema",
              name: input.schemaName,
              schema: input.schema,
            },
          }
        : undefined,
    }),
  });

  if (!res.ok) return null;
  const json = (await res.json()) as OpenAIResponse;
  if (!json.output_text) return null;
  const data = parseJson<T>(json.output_text);
  if (!data) return null;

  return {
    data,
    provider: "openai",
    model,
    cacheHit: false,
    usage: {
      promptTokens: json.usage?.input_tokens ?? 0,
      completionTokens: json.usage?.output_tokens ?? 0,
      totalTokens: json.usage?.total_tokens ?? 0,
    },
  };
}

export async function callAiJson<T>(input: AiJsonCallInput): Promise<AiProviderResult<T> | null> {
  const preference = providerPreference();
  const primaryProvider = preference === "openai" && allowOpenAiTextFallback() ? "openai" : "minimax";
  const primaryModel = primaryProvider === "minimax" ? selectMiniMaxModel(input) : process.env.OPENAI_MODEL || "gpt-5.4";
  const { key, requestHash } = cacheKey(input, primaryProvider, primaryModel);
  const cached = readCache<T>(key);
  if (cached) {
    logUsage({ provider: primaryProvider, model: primaryModel, routeKind: input.routeKind, cacheHit: true, requestHash, usage: cached.usage });
    return cached;
  }

  const callers =
    primaryProvider === "minimax"
      ? allowOpenAiTextFallback()
        ? [callMiniMax<T>, callOpenAI<T>]
        : [callMiniMax<T>]
      : [callOpenAI<T>, callMiniMax<T>];
  for (const caller of callers) {
    const result = await caller(input);
    if (!result) continue;
    const provider = result.provider;
    const { key: providerCacheKey, requestHash: providerRequestHash } = cacheKey(input, provider, result.model);
    writeCache({
      key: providerCacheKey,
      provider,
      model: result.model,
      routeKind: input.routeKind,
      requestHash: providerRequestHash,
      data: result.data,
      usage: result.usage,
      ttl: ttlSeconds(input.cacheTtlSeconds),
    });
    logUsage({ provider, model: result.model, routeKind: input.routeKind, cacheHit: false, requestHash: providerRequestHash, usage: result.usage });
    return result;
  }

  return null;
}

export function listAiMetrics() {
  const db = getDb();
  const usage = db
    .prepare(
      `SELECT provider, model, route_kind AS routeKind,
        COUNT(*) AS calls,
        SUM(cache_hit) AS cacheHits,
        SUM(prompt_tokens) AS promptTokens,
        SUM(completion_tokens) AS completionTokens,
        SUM(total_tokens) AS totalTokens
       FROM ai_usage_logs
       GROUP BY provider, model, route_kind
       ORDER BY calls DESC, totalTokens DESC`
    )
    .all();
  const cache = db
    .prepare(
      `SELECT provider, model, route_kind AS routeKind, COUNT(*) AS entries, SUM(hits) AS hits
       FROM ai_response_cache
       GROUP BY provider, model, route_kind
       ORDER BY hits DESC`
    )
    .all();
  const rl = db
    .prepare(
      `SELECT actor_role AS actorRole, route_kind AS routeKind, action_key AS actionKey,
        COUNT(*) AS events, AVG(reward) AS averageReward, MAX(created_at) AS latestAt
       FROM ai_rl_events
       GROUP BY actor_role, route_kind, action_key
       ORDER BY latestAt DESC`
    )
    .all();
  const qValues = db
    .prepare(
      `SELECT state_key AS stateKey, action_key AS actionKey, q_value AS qValue, visits, updated_at AS updatedAt
       FROM ai_rl_q_values
       ORDER BY updated_at DESC
       LIMIT 20`
    )
    .all();
  const groundTruth = db
    .prepare(
      `SELECT actor_role AS actorRole, route_kind AS routeKind, scope_key AS scopeKey,
              COUNT(*) AS memories, SUM(reuse_count) AS reuses, AVG(relevance_score) AS averageRelevance,
              MAX(updated_at) AS latestAt
       FROM ground_truth_memories
       GROUP BY actor_role, route_kind, scope_key
       ORDER BY latestAt DESC
       LIMIT 30`,
    )
    .all();
  return { usage, cache, rl, qValues, groundTruth, feedback: listFeedbackMetrics() };
}
