import { getDb } from "./db";
import { getPatientDocument, listPatientDocuments } from "./patientDocuments";
import { getFirstAidAnswer } from "./firstAid";
import { buildUnifiedAiResponse } from "./aiOrchestrator";
import { callAiJson } from "./aiProvider";
import { recordAiReward } from "./rlMetrics";
import { findGroundTruthMemory, saveGroundTruthMemory } from "./groundTruthMemory";

type AskDocsOptions = {
  userId: string;
  query: string;
  documentId?: string | null;
};

type EvidenceObservation = {
  testName: string;
  valueText: string | null;
  unit: string | null;
  referenceRange: string | null;
  abnormalFlag: string | null;
};

type EvidenceChunk = {
  documentId: string;
  fileName: string;
  chunkIndex: number;
  content: string;
  score: number;
};

export type PatientChatResult = {
  mode: "report" | "firstaid" | "booking";
  answer: string;
  evidenceSource: string;
  cautionLevel: "low" | "moderate" | "high";
  escalationNote: string;
  fallback: boolean;
  sourceDetails?: string[];
};

function scoreText(query: string, candidate: string) {
  const qTokens = query.toLowerCase().split(/\W+/).filter(Boolean);
  const c = candidate.toLowerCase();
  let score = 0;
  for (const token of qTokens) {
    if (c.includes(token)) score += 1;
  }
  return score;
}

function buildObservationNarrative(observations: EvidenceObservation[]) {
  if (observations.length === 0) return "";
  return observations
    .slice(0, 5)
    .map((obs) => {
      const pieces = [`${obs.testName}`];
      if (obs.valueText) pieces.push(`value ${obs.valueText}${obs.unit ? ` ${obs.unit}` : ""}`);
      if (obs.referenceRange) pieces.push(`reference ${obs.referenceRange}`);
      if (obs.abnormalFlag) pieces.push(`flag ${obs.abnormalFlag}`);
      return pieces.join(", ");
    })
    .join("; ");
}

function retrieveEvidence({ userId, query, documentId }: AskDocsOptions) {
  const db = getDb();
  const selected = documentId ? getPatientDocument(documentId, userId) : null;
  const documents = selected ? [selected] : listPatientDocuments(userId).slice(0, 10);

  const chunks: EvidenceChunk[] = [];
  const observations: EvidenceObservation[] = [];

  for (const document of documents) {
    const detail = selected && document.id === selected.id ? selected : getPatientDocument(document.id, userId);
    if (!detail) continue;

    for (const observation of detail.observations) {
      const observationScore = scoreText(query, `${observation.testName} ${observation.valueText ?? ""} ${observation.referenceRange ?? ""} ${observation.abnormalFlag ?? ""}`);
      if (observationScore > 0) {
        observations.push({
          testName: observation.testName,
          valueText: observation.valueText,
          unit: observation.unit,
          referenceRange: observation.referenceRange,
          abnormalFlag: observation.abnormalFlag,
        });
      }
    }

    const chunkRows = db
      .prepare(
        `SELECT chunk_index, content
         FROM document_chunks
         WHERE document_id = ?
         ORDER BY chunk_index ASC`
      )
      .all(document.id) as Array<{ chunk_index: number; content: string }>;

    for (const row of chunkRows) {
      const score = scoreText(query, row.content);
      if (score > 0 || (!selected && chunks.length < 2)) {
        chunks.push({
          documentId: document.id,
          fileName: detail.fileName,
          chunkIndex: row.chunk_index,
          content: row.content,
          score,
        });
      }
    }
  }

  const sortedChunks = chunks.sort((a, b) => b.score - a.score).slice(0, 4);
  const uniqueObservations = Array.from(
    new Map(observations.map((item) => [item.testName + item.valueText + item.referenceRange, item])).values(),
  ).slice(0, 8);

  return { chunks: sortedChunks, observations: uniqueObservations, selectedDocument: selected };
}

async function callAiForPatientDocs({
  query,
  evidence,
}: {
  query: string;
  evidence: { chunks: EvidenceChunk[]; observations: EvidenceObservation[]; fileName?: string | null };
}) {
  const evidenceText = [
    evidence.fileName ? `Primary document: ${evidence.fileName}` : null,
    evidence.observations.length
      ? `Structured observations: ${buildObservationNarrative(evidence.observations)}`
      : "Structured observations: none extracted.",
    evidence.chunks.length
      ? `Retrieved report text:\n${evidence.chunks.map((chunk, index) => `Chunk ${index + 1}: ${chunk.content}`).join("\n\n")}`
      : "Retrieved report text: none.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return callAiJson<{
    answer: string;
    cautionLevel: "low" | "moderate" | "high";
    escalationNote: string;
  }>({
    routeKind: "patient_document_qa",
    system:
      "You are a patient-safe medical report explainer. Answer the patient's exact question naturally and plainly. Use only the provided report evidence; do not invent diagnoses, values, or test results. Avoid canned openings. Explain what the evidence says, what it does not prove, and what to ask the doctor next. Aim for 100-260 words unless the evidence is complex. Return strict JSON with keys answer, cautionLevel, escalationNote.",
    user: `Patient question: ${query}\n\nEvidence:\n${evidenceText}`,
    schemaName: "patient_document_answer",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        answer: { type: "string" },
        cautionLevel: { type: "string", enum: ["low", "moderate", "high"] },
        escalationNote: { type: "string" },
      },
      required: ["answer", "cautionLevel", "escalationNote"],
    },
    temperature: 0.2,
    maxTokens: 850,
    modelTier: "light",
  });
}

function buildFallbackDocAnswer({
  query,
  chunks,
  observations,
  fileName,
}: {
  query: string;
  chunks: EvidenceChunk[];
  observations: EvidenceObservation[];
  fileName?: string | null;
}) {
  const lines: string[] = [];
  if (fileName) {
    lines.push(`I reviewed the uploaded report${fileName ? ` (${fileName})` : ""}.`);
  } else {
    lines.push("I reviewed the available uploaded report evidence.");
  }

  if (observations.length > 0) {
    lines.push(`Relevant extracted results include ${buildObservationNarrative(observations)}.`);
  }

  if (chunks.length > 0) {
    lines.push(`The report text most related to your question says: "${chunks[0].content.slice(0, 280)}${chunks[0].content.length > 280 ? "..." : ""}"`);
  }

  if (observations.length === 0 && chunks.length === 0) {
    lines.push(`I could not find enough matching report evidence for the question "${query}".`);
  }

  const highFlag = observations.some((item) => item.abnormalFlag && ["high", "low", "abnormal"].includes(item.abnormalFlag.toLowerCase()));
  return {
    answer: lines.join(" "),
    cautionLevel: highFlag ? ("high" as const) : observations.length > 0 ? ("moderate" as const) : ("low" as const),
    escalationNote: highFlag
      ? "Some extracted results appear flagged or abnormal. Please review this report with a doctor instead of relying only on the assistant."
      : "Use this as a supportive explanation only. If you feel unwell, symptoms worsen, or the report contains worrying findings, contact a clinician.",
  };
}

export async function answerPatientDocuments(options: AskDocsOptions): Promise<PatientChatResult> {
  const memory = findGroundTruthMemory({
    actorRole: "patient",
    routeKind: "patient_document_qa",
    scopeKey: options.documentId || options.userId,
    question: options.query,
    threshold: 0.82,
  });
  if (memory) {
    return {
      mode: "report",
      answer: memory.answer,
      evidenceSource: "Saved ground-truth memory",
      cautionLevel: (memory.caution as "low" | "moderate" | "high") || "moderate",
      escalationNote: "This reuses a previously saved relevant answer. If symptoms or report values changed, ask a fresh question or contact a clinician.",
      fallback: false,
      sourceDetails: [`Relevance ${(memory.relevanceScore * 100).toFixed(0)}%`, `Reused ${memory.reuseCount + 1} time(s)`],
    };
  }

  const evidence = retrieveEvidence(options);
  const evidenceSource = evidence.selectedDocument
    ? `Uploaded report: ${evidence.selectedDocument.fileName}`
    : evidence.chunks[0]
      ? `Uploaded report: ${evidence.chunks[0].fileName}`
      : "Uploaded patient reports";

  if (evidence.chunks.length === 0 && evidence.observations.length === 0) {
    const result = {
      mode: "report",
      answer:
        "I could not find enough relevant evidence in the uploaded documents to answer that safely. Try selecting a specific report or asking about a named test value from the report.",
      evidenceSource,
      cautionLevel: "moderate",
      escalationNote:
        "If the question is urgent or the report seems concerning, please review it directly with a clinician.",
      fallback: true,
      sourceDetails: [],
    } satisfies PatientChatResult;
    saveGroundTruthMemory({
      actorRole: "patient",
      routeKind: "patient_document_qa",
      scopeKey: options.documentId || options.userId,
      question: options.query,
      answer: result.answer,
      evidence: [],
      relevanceScore: 0,
      caution: result.cautionLevel,
      sourceMode: "no_matching_report_evidence",
      model: "deterministic-fallback",
      fallback: true,
    });
    return result;
  }

  const aiResult = await callAiForPatientDocs({
    query: options.query,
    evidence: {
      chunks: evidence.chunks,
      observations: evidence.observations,
      fileName: evidence.selectedDocument?.fileName ?? evidence.chunks[0]?.fileName ?? null,
    },
  });

  const gptResult = aiResult?.data ?? null;
  const finalResult =
    gptResult ??
    buildFallbackDocAnswer({
      query: options.query,
      chunks: evidence.chunks,
      observations: evidence.observations,
      fileName: evidence.selectedDocument?.fileName ?? evidence.chunks[0]?.fileName ?? null,
    });

  recordAiReward({
    actorRole: "patient",
    routeKind: "patient_document_qa",
    actionKey: gptResult ? `${aiResult?.provider || "ai"}:grounded-answer` : "fallback:document-answer",
    fallback: !gptResult,
    cacheHit: Boolean(aiResult?.cacheHit),
    evidenceCount: evidence.observations.length + evidence.chunks.length,
    caution: finalResult.cautionLevel,
    answerLength: finalResult.answer.length,
    model: gptResult ? aiResult?.model : "deterministic-fallback",
  });

  const response = Object.assign(
    {
      mode: "report" as const,
      evidenceSource: gptResult ? `${evidenceSource} · ${aiResult?.provider || "AI"} grounded synthesis` : `${evidenceSource} · deterministic fallback`,
      cautionLevel: finalResult.cautionLevel,
      escalationNote: finalResult.escalationNote,
      sourceDetails: [
        ...evidence.observations.slice(0, 3).map((item) => `${item.testName}${item.valueText ? `: ${item.valueText}${item.unit ? ` ${item.unit}` : ""}` : ""}`),
        ...evidence.chunks.slice(0, 2).map((item) => `${item.fileName} · chunk ${item.chunkIndex + 1}`),
      ],
    },
    buildUnifiedAiResponse({
      answer: finalResult.answer,
      evidence: [
        ...evidence.observations.slice(0, 3).map((item) => `${item.testName}${item.valueText ? ` ${item.valueText}` : ""}`),
        ...evidence.chunks.slice(0, 2).map((item) => `${item.fileName} · chunk ${item.chunkIndex + 1}`),
      ],
      caution: finalResult.cautionLevel,
      escalation: finalResult.escalationNote,
      sourceMode: gptResult ? aiResult?.provider || "ai" : "fallback",
      model: gptResult ? aiResult?.model || "ai-provider" : "deterministic-fallback",
      fallback: !gptResult,
    }),
  );
  saveGroundTruthMemory({
    actorRole: "patient",
    routeKind: "patient_document_qa",
    scopeKey: options.documentId || options.userId,
    question: options.query,
    answer: response.answer,
    evidence: response.sourceDetails || [],
    relevanceScore: evidence.observations.length + evidence.chunks.length > 0 ? 1 : 0.4,
    caution: response.cautionLevel,
    sourceMode: response.evidenceSource,
    model: gptResult ? aiResult?.model || "ai-provider" : "deterministic-fallback",
    fallback: response.fallback,
  });
  return response;
}

export async function answerPatientChat({
  userId,
  query,
  mode,
  documentId,
}: {
  userId: string;
  query: string;
  mode: "report" | "firstaid" | "booking";
  documentId?: string | null;
}): Promise<PatientChatResult> {
  if (mode === "booking") {
    return {
      mode,
      answer:
        "Appointment booking mode is ready in the UI flow, but actual scheduling will be connected in the appointment step. For now, use this mode to signal that you want to request a doctor visit.",
      evidenceSource: "Booking workflow placeholder",
      cautionLevel: "moderate",
      escalationNote: "If this is an emergency, do not wait for in-app booking. Contact emergency services or urgent care immediately.",
      fallback: true,
      sourceDetails: [],
    };
  }

  if (mode === "report") {
    return answerPatientDocuments({ userId, query, documentId });
  }

  const firstAid = await getFirstAidAnswer(query);
  const memory = findGroundTruthMemory({
    actorRole: "patient",
    routeKind: "patient_first_aid",
    scopeKey: userId,
    question: query,
    threshold: 0.82,
  });
  if (memory) {
    return {
      mode,
      answer: memory.answer,
      evidenceSource: "Saved ground-truth memory",
      cautionLevel: (memory.caution as "low" | "moderate" | "high") || "moderate",
      escalationNote: "This reuses a previously saved relevant first-aid answer. Seek urgent care if symptoms are severe, sudden, unusual, or worsening.",
      fallback: false,
      sourceDetails: [`Relevance ${(memory.relevanceScore * 100).toFixed(0)}%`, `Reused ${memory.reuseCount + 1} time(s)`],
    };
  }
  const firstAidEvidence = firstAid.tips.map((tip, index) => `Source ${index + 1}: ${tip.title}\n${tip.detail}`).join("\n\n");
  const aiResult = await callAiJson<{ answer: string; cautionLevel: "low" | "moderate" | "high"; escalationNote: string }>({
    routeKind: "patient_first_aid",
    system:
      "You are a patient-safe first-aid assistant. Answer the exact symptom question naturally and plainly using only the supplied local first-aid ground truth. Do not diagnose or prescribe. Avoid generic one-line advice. Include what to do now, what to watch for, and when to seek care. For chest pain, heart symptoms, severe breathing trouble, weakness, confusion, fainting, severe bleeding, or sudden severe symptoms, clearly advise urgent/emergency care. Aim for 100-240 words. Return strict JSON with answer, cautionLevel, escalationNote.",
    user: `Patient question: ${query}\n\nLocal first-aid ground truth:\n${firstAidEvidence}`,
    schemaName: "patient_first_aid_answer",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        answer: { type: "string" },
        cautionLevel: { type: "string", enum: ["low", "moderate", "high"] },
        escalationNote: { type: "string" },
      },
      required: ["answer", "cautionLevel", "escalationNote"],
    },
    modelTier: "light",
    maxTokens: 800,
    temperature: 0.35,
  });
  const ai = aiResult?.data && typeof aiResult.data.answer === "string" && aiResult.data.answer.trim() ? aiResult : null;
  recordAiReward({
    actorRole: "patient",
    routeKind: "patient_first_aid",
    actionKey: ai ? `${ai.provider}:first-aid-synthesis` : firstAid.fallback ? "fallback:first-aid" : "rules:first-aid",
    fallback: !ai,
    cacheHit: Boolean(ai?.cacheHit),
    evidenceCount: firstAid.tips.length,
    caution: ai?.data.cautionLevel || firstAid.cautionLevel,
    answerLength: (ai?.data.answer || firstAid.tips[0]?.detail || "").length,
    model: ai?.model || firstAid.source,
  });
  const response = Object.assign(
    {
      mode,
      evidenceSource: ai ? `${firstAid.source} · MiniMax synthesis` : firstAid.source,
      cautionLevel: ai?.data.cautionLevel || firstAid.cautionLevel,
      escalationNote: ai?.data.escalationNote || firstAid.escalationNote,
      sourceDetails: firstAid.tips.map((tip) => tip.title),
    },
    buildUnifiedAiResponse({
      answer: ai?.data.answer || firstAid.tips[0]?.detail || "No guidance available.",
      evidence: firstAid.tips.map((tip) => tip.title),
      caution: ai?.data.cautionLevel || firstAid.cautionLevel,
      escalation: ai?.data.escalationNote || firstAid.escalationNote,
      sourceMode: ai ? ai.provider : firstAid.fallback ? "fallback" : "rules",
      model: ai?.model || firstAid.source,
      fallback: !ai,
    }),
  );
  saveGroundTruthMemory({
    actorRole: "patient",
    routeKind: "patient_first_aid",
    scopeKey: userId,
    question: query,
    answer: response.answer,
    evidence: response.sourceDetails || [],
    relevanceScore: firstAid.fallback ? 0.45 : 1,
    caution: response.cautionLevel,
    sourceMode: response.evidenceSource,
    model: ai?.model || firstAid.source,
    fallback: response.fallback,
  });
  return response;
}
