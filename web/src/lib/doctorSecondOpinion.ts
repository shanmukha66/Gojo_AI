import { callAiJson } from "./aiProvider";
import { recordAiReward } from "./rlMetrics";
import { findGroundTruthMemory, saveGroundTruthMemory } from "./groundTruthMemory";

import { searchGroundTruthSources, type GroundTruthHit } from "./groundTruthLibrary";

type KnowledgeRow = {
  topic: string;
  keywords: string;
  source_title: string;
  source_type: string;
  content: string;
  caution: "low" | "moderate" | "high";
};

export type DoctorSecondOpinionResult = {
  answer: string;
  evidence: string[];
  caution: "low" | "moderate" | "high";
  escalation: string;
  source_mode: string;
  model: string;
  fallback: boolean;
  timestamp: string;
  sources: Array<{ title: string; topic: string; type: string; content: string }>;
};

function nowIso() {
  return new Date().toISOString();
}

function retrieveKnowledge(query: string) {
  return searchGroundTruthSources(query, 5).map((source) => ({
    topic: source.specialty || source.title,
    keywords: source.tags || "",
    source_title: source.title,
    source_type: source.sourceType,
    content: source.content,
    caution: inferCaution(source),
  }));
}

function inferCaution(source: GroundTruthHit): "low" | "moderate" | "high" {
  const text = `${source.title} ${source.tags || ""} ${source.content}`.toLowerCase();
  if (/emergency|urgent|chest pain|stroke|bleeding|fracture|severe|shortness of breath|fainting/.test(text)) return "high";
  if (/monitor|follow-up|abnormal|risk|medication|kidney|renal|copd|heart/.test(text)) return "moderate";
  return "low";
}

function highestCaution(rows: KnowledgeRow[]): "low" | "moderate" | "high" {
  if (rows.some((row) => row.caution === "high")) return "high";
  if (rows.some((row) => row.caution === "moderate")) return "moderate";
  return "low";
}

function fallbackAnswer(query: string, rows: KnowledgeRow[]): DoctorSecondOpinionResult {
  const caution = highestCaution(rows);
  const evidence = rows.map((row) => `${row.source_title}: ${row.content}`);
  if (!rows.length) {
    return {
      answer:
        "I do not have a reliable local source for this exact question yet, so I should not stretch unrelated material into an answer.\n\nIf this is a quick clinical clarification, add a relevant guideline, PDF, blood report, note, or patient chart context and ask again. If the situation involves instability, severe pain, possible fracture, breathing trouble, neurologic symptoms, severe bleeding, or cancer-treatment decisions, route it to the appropriate clinician or specialist rather than relying on the copilot.",
      evidence: [],
      caution: "high",
      escalation: "No matching local ground truth was found. Use clinician judgment and add a trusted source before relying on AI output.",
      source_mode: "no_matching_ground_truth",
      model: "deterministic-fallback",
      fallback: true,
      timestamp: nowIso(),
      sources: [],
    };
  }
  return {
    answer: `Based on the matching local source material, the useful points are:\n\n${rows.map((row) => `- ${row.content}`).join("\n")}\n\nBefore acting on this, check the patient-specific context: current symptoms, vitals, allergies, kidney/liver function, pregnancy status when relevant, medication list, recent labs, and whether there are red flags. Treat this as decision support, not a final plan.`,
    evidence,
    caution,
    escalation: caution === "high" ? "If the scenario involves red-flag symptoms or unstable vitals, escalate to urgent/emergency care rather than routine advice." : "Use this as second-opinion support and verify against the patient chart before acting.",
    source_mode: "local_ground_truth_fallback",
    model: "deterministic-fallback",
    fallback: true,
    timestamp: nowIso(),
    sources: rows.map((row) => ({ title: row.source_title, topic: row.topic, type: row.source_type, content: row.content })),
  };
}

export async function answerDoctorSecondOpinion(input: { doctorId: string; question: string }): Promise<DoctorSecondOpinionResult> {
  const memory = findGroundTruthMemory({
    actorRole: "doctor",
    routeKind: "doctor_general_second_opinion",
    scopeKey: input.doctorId,
    question: input.question,
    threshold: 0.82,
  });
  if (memory) {
    return {
      answer: memory.answer,
      evidence: JSON.parse(memory.evidenceJson || "[]") as string[],
      caution: (memory.caution as "low" | "moderate" | "high") || "moderate",
      escalation: "Reused a saved relevant ground-truth answer. Verify patient-specific details before acting.",
      source_mode: "saved_ground_truth_memory",
      model: memory.model || "stored-ground-truth",
      fallback: false,
      timestamp: nowIso(),
      sources: [],
    };
  }

  const knowledge = retrieveKnowledge(input.question);
  const caution = highestCaution(knowledge);
  if (!knowledge.length) {
    const result = fallbackAnswer(input.question, knowledge);
    saveGroundTruthMemory({
      actorRole: "doctor",
      routeKind: "doctor_general_second_opinion",
      scopeKey: input.doctorId,
      question: input.question,
      answer: result.answer,
      evidence: result.evidence,
      relevanceScore: 0,
      caution: result.caution,
      sourceMode: result.source_mode,
      model: result.model,
      fallback: result.fallback,
    });
    recordAiReward({
      actorRole: "doctor",
      routeKind: "doctor_general_second_opinion",
      actionKey: "fallback:no-matching-ground-truth",
      fallback: true,
      evidenceCount: 0,
      caution: result.caution,
      answerLength: result.answer.length,
      model: result.model,
    });
    return result;
  }
  const evidenceText = knowledge.map((row, index) => `Source ${index + 1}: ${row.source_title}\nTopic: ${row.topic}\nText: ${row.content}\nCaution: ${row.caution}`).join("\n\n");
  const ai = await callAiJson<{ answer: string; caution: "low" | "moderate" | "high"; escalation: string }>({
    routeKind: "doctor_general_second_opinion",
    system:
      "You are a doctor-facing copilot. Answer the specific question naturally, without starting with canned phrases such as 'For this general clinical doubt' or 'I found local knowledge sources'. Use only the supplied local knowledge sources and any uploaded context. Keep it practical: direct answer first, then key reasoning, what to verify, and escalation if needed. Do not prescribe, do not replace clinician judgment, and do not invent facts. Aim for 120-300 words unless the question clearly needs more. Return strict JSON with answer, caution, escalation.",
    user: `Doctor question: ${input.question}\n\nLocal ground-truth knowledge:\n${evidenceText}`,
    schemaName: "doctor_second_opinion",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        answer: { type: "string" },
        caution: { type: "string", enum: ["low", "moderate", "high"] },
        escalation: { type: "string" },
      },
      required: ["answer", "caution", "escalation"],
    },
    modelTier: "light",
    maxTokens: 950,
    temperature: 0.35,
  });

  const hasValidAiAnswer = typeof ai?.data?.answer === "string" && ai.data.answer.trim().length > 0;
  const result: DoctorSecondOpinionResult = hasValidAiAnswer
    ? {
        answer: ai.data.answer.trim(),
        evidence: knowledge.map((row) => `${row.source_title}: ${row.content}`),
        caution: ai.data.caution || caution,
        escalation: typeof ai.data.escalation === "string" && ai.data.escalation.trim() ? ai.data.escalation : "Use this as second-opinion support and verify against the patient chart before acting.",
        source_mode: ai?.provider || "minimax",
        model: ai?.model || "MiniMax",
        fallback: false,
        timestamp: nowIso(),
        sources: knowledge.map((row) => ({ title: row.source_title, topic: row.topic, type: row.source_type, content: row.content })),
      }
    : fallbackAnswer(input.question, knowledge);

  recordAiReward({
    actorRole: "doctor",
    routeKind: "doctor_general_second_opinion",
    actionKey: result.fallback ? "fallback:second-opinion" : `${ai?.provider || "ai"}:second-opinion`,
    fallback: result.fallback,
    cacheHit: Boolean(ai?.cacheHit),
    evidenceCount: result.evidence.length,
    caution: result.caution,
    answerLength: result.answer.length,
    model: result.model,
  });

  saveGroundTruthMemory({
    actorRole: "doctor",
    routeKind: "doctor_general_second_opinion",
    scopeKey: input.doctorId,
    question: input.question,
    answer: result.answer,
    evidence: result.evidence,
    relevanceScore: result.evidence.length ? 1 : 0.35,
    caution: result.caution,
    sourceMode: result.source_mode,
    model: result.model,
    fallback: result.fallback,
  });

  return result;
}
