export type UnifiedAiResponse = {
  answer: string;
  evidence: string[];
  caution: string;
  escalation: string;
  source_mode: string;
  model: string;
  fallback: boolean;
  timestamp: string;
};

export function nowAiTimestamp() {
  return new Date().toISOString();
}

export function buildUnifiedAiResponse(input: {
  answer: string;
  evidence?: string[];
  caution?: string;
  escalation?: string;
  sourceMode: string;
  model: string;
  fallback: boolean;
}) {
  return {
    answer: input.answer,
    evidence: input.evidence || [],
    caution: input.caution || "moderate",
    escalation: input.escalation || "Use this as supportive guidance and escalate to a clinician when evidence is insufficient.",
    source_mode: input.sourceMode,
    model: input.model,
    fallback: input.fallback,
    timestamp: nowAiTimestamp(),
  } satisfies UnifiedAiResponse;
}
