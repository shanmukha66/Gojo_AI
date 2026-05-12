import { createAiAuditLog } from "./aiAudit";
import { listDoctorMemos, listPatientMemos } from "./doctorMemos";
import type { GraphEvidencePath } from "./knowledgeGraph";
import { getDoctorPatientTimeline } from "./doctorWorkspace";
import { exportDoctorPatientReportWorkbook } from "./recordExports";
import { listPatientReviews } from "./patientReviews";
import { callAiJson } from "./aiProvider";
import { recordAiReward } from "./rlMetrics";

export type CopilotProvenance = {
  evidenceReferences: string[];
  model: string;
  mode: "gpt" | "fallback";
};

export type DoctorCopilotAnswer = {
  answer: string;
  evidenceSource: string;
  sourceDetails: string[];
  graphPaths: GraphEvidencePath[];
  fallback: boolean;
  provenance: CopilotProvenance;
};

export type DoctorDecisionReport = {
  title: string;
  summary: string;
  evidenceUsed: string[];
  actionItems: string[];
  cautionPoints: string[];
  clinicianNote: string;
  graphPaths: GraphEvidencePath[];
  fallback: boolean;
  provenance: CopilotProvenance;
};

function riskBand(risk: number) {
  if (risk >= 0.75) return "high";
  if (risk >= 0.5) return "moderate";
  return "lower";
}

function tokenize(input: string) {
  return input.toLowerCase().split(/\W+/).filter(Boolean);
}

function scoreText(query: string, candidate: string) {
  const tokens = tokenize(query);
  const c = candidate.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (c.includes(token)) score += 1;
  }
  return score;
}

async function buildEvidenceBundle(patientId: string, doctorId: string) {
  const timeline = await getDoctorPatientTimeline(patientId, doctorId);
  if (!timeline) throw new Error("Patient not found");

  const personalMemos = listDoctorMemos(doctorId).slice(0, 5);
  const patientMemos = listPatientMemos(doctorId, patientId).slice(0, 8);
  const patientReviews = listPatientReviews(doctorId, patientId).slice(0, 6);

  const evidenceReferences = [
    ...timeline.events.slice(0, 10).map((event) => `${event.type}:${event.title}`),
    ...timeline.documentDetails.slice(0, 4).map((document) => `document:${document.fileName}`),
    ...timeline.graphPaths.slice(0, 6).map((path) => `graph:${path.sourceCategory}:${path.title}`),
    ...patientMemos.slice(0, 5).map((memo) => `patient-memo:${memo.title}`),
    ...patientReviews.slice(0, 5).map((review) => `patient-review:${review.title}`),
    ...personalMemos.slice(0, 3).map((memo) => `doctor-memo:${memo.title}`),
  ];

  return {
    timeline,
    personalMemos,
    patientMemos,
    patientReviews,
    evidenceReferences,
  };
}

function buildFallbackCopilotAnswer(query: string, bundle: Awaited<ReturnType<typeof buildEvidenceBundle>>): DoctorCopilotAnswer {
  const topEvents = bundle.timeline.events
    .map((event) => ({
      event,
      score: scoreText(query, `${event.title} ${event.description} ${event.sourceCategory}`),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => item.event);

  const topMemo = bundle.patientMemos[0] || bundle.personalMemos[0];
  const topReview = bundle.patientReviews[0];
  const reportSummary = bundle.timeline.documentDetails[0]?.observations
    .slice(0, 4)
    .map((obs) => `${obs.testName}${obs.valueText ? ` ${obs.valueText}${obs.unit ? ` ${obs.unit}` : ""}` : ""}`)
    .join(", ");

  const answer = [
    `For "${query}", the strongest available evidence points to ${topEvents
      .map((event) => `${event.title} on ${event.at || "unknown date"}`)
      .join("; ")}.`,
    reportSummary ? `Structured report findings include ${reportSummary}.` : "No strong structured report findings matched the question.",
    topReview ? `Recent formal review: ${topReview.title} — ${topReview.summary.slice(0, 180)}${topReview.summary.length > 180 ? "..." : ""}` : "No formal review context matched this question.",
    topMemo ? `Recent memo context: ${topMemo.title} — ${topMemo.body.slice(0, 180)}${topMemo.body.length > 180 ? "..." : ""}` : "No memo context matched this question.",
  ].join(" ");

  return {
    answer,
    evidenceSource: "Timeline, uploaded reports, extracted findings, and doctor memos",
    sourceDetails: bundle.evidenceReferences.slice(0, 8),
    graphPaths: bundle.timeline.graphPaths,
    fallback: true,
    provenance: {
      evidenceReferences: bundle.evidenceReferences,
      model: "deterministic-fallback",
      mode: "fallback",
    },
  };
}

function buildFallbackDecisionReport(bundle: Awaited<ReturnType<typeof buildEvidenceBundle>>): DoctorDecisionReport {
  const patient = bundle.timeline.patient;
  const risk = patient.risk ?? 0;
  const band = riskBand(risk);
  const conditionCount = bundle.timeline.conditions.length;
  const recentVisits = bundle.timeline.visits.slice(0, 4).map((visit) => `${visit.start || "Unknown date"} · ${visit.typeName || "Visit"}`);
  const memoTitles = bundle.patientMemos.slice(0, 3).map((memo) => memo.title);
  const reviewTitles = bundle.patientReviews.slice(0, 3).map((review) => review.title);

  const evidenceUsed = [
    recentVisits.length ? `Recent visits: ${recentVisits.join("; ")}.` : "No recent visit events available.",
    conditionCount ? `Condition burden: ${conditionCount} active condition(s) in the current graph snapshot.` : "No active condition evidence available.",
    bundle.timeline.documentDetails[0]
      ? `Latest report: ${bundle.timeline.documentDetails[0].fileName} with ${bundle.timeline.documentDetails[0].observations.length} structured finding(s).`
      : "No uploaded patient report linked yet.",
    reviewTitles.length ? `Formal reviews: ${reviewTitles.join(", ")}.` : "No formal patient reviews documented yet.",
    memoTitles.length ? `Existing memo context: ${memoTitles.join(", ")}.` : "No patient-specific memos documented yet.",
    bundle.timeline.graphPaths.length
      ? `Graph evidence paths: ${bundle.timeline.graphPaths
          .slice(0, 3)
          .map((path) => `${path.sourceCategory} via ${path.title}`)
          .join("; ")}.`
      : "No graph evidence paths available yet.",
  ];

  const actionItems = [
    "Review the latest uploaded report and memo context before finalizing the encounter plan.",
    band === "high"
      ? "Prioritize near-term follow-up and confirm whether acute-care escalation criteria are present."
      : "Confirm follow-up interval and close evidence gaps before documenting the plan.",
    bundle.timeline.documentDetails[0]?.observations.some((obs) => obs.abnormalFlag)
      ? "Validate flagged observations against the original report and correlate with symptoms."
      : "Use the extracted findings as supportive context and verify against the original report if needed.",
  ];

  const cautionPoints = [
    "The copilot summary is secondary support and should not replace direct chart review.",
    "Synthetic and uploaded evidence may be incomplete; verify dates, flags, and memo context before acting.",
    "Final decision remains with clinician.",
  ];

  return {
    title: "Doctor Decision Support Report",
    summary: `${patient.name || "Patient"} (ID ${patient.id}) currently sits in the ${band} risk band (${Math.round(risk * 100)}%) based on timeline, condition burden, and report-linked evidence.`,
    evidenceUsed,
    actionItems,
    cautionPoints,
    clinicianNote: "Final decision remains with clinician.",
    graphPaths: bundle.timeline.graphPaths,
    fallback: true,
    provenance: {
      evidenceReferences: bundle.evidenceReferences,
      model: "deterministic-fallback",
      mode: "fallback",
    },
  };
}

async function callAi<T>(input: {
  routeKind: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  modelTier?: "light" | "reasoning";
}) {
  return callAiJson<T>({
    routeKind: input.routeKind,
    system: input.system,
    user: input.user,
    schemaName: input.schemaName,
    schema: input.schema,
    temperature: 0.2,
    maxTokens: input.routeKind === "doctor_decision_report" ? 1500 : 1000,
    modelTier: input.modelTier || "light",
  });
}

function bundleNarrative(bundle: Awaited<ReturnType<typeof buildEvidenceBundle>>) {
  const timelineLines = bundle.timeline.events
    .slice(0, 12)
    .map((event) => `${event.at || "Unknown date"} | ${event.type} | ${event.title} | ${event.description}`)
    .join("\n");
  const reportLines = bundle.timeline.documentDetails
    .slice(0, 3)
    .map((document) => {
      const findings = document.observations
        .slice(0, 6)
        .map((obs) => `${obs.testName}${obs.valueText ? ` ${obs.valueText}${obs.unit ? ` ${obs.unit}` : ""}` : ""}${obs.abnormalFlag ? ` (${obs.abnormalFlag})` : ""}`)
        .join(", ");
      return `${document.fileName}: ${findings || document.extractedText?.slice(0, 260) || "No extracted content"}`;
    })
    .join("\n");
  const memoLines = bundle.patientMemos
    .slice(0, 5)
    .map((memo) => `${memo.updatedAt} | ${memo.status} | ${memo.title} | ${memo.body}`)
    .join("\n");
  const personalMemoLines = bundle.personalMemos
    .slice(0, 3)
    .map((memo) => `${memo.updatedAt} | ${memo.type} | ${memo.title} | ${memo.body}`)
    .join("\n");
  const reviewLines = bundle.patientReviews
    .slice(0, 5)
    .map((review) => `${review.updatedAt} | ${review.status} | ${review.title} | ${review.summary}`)
    .join("\n");
  return [
    `Patient: ${bundle.timeline.patient.name || "Patient"} (ID ${bundle.timeline.patient.id})`,
    `Timeline:\n${timelineLines || "No timeline events."}`,
    `Reports:\n${reportLines || "No linked reports."}`,
    `Patient reviews:\n${reviewLines || "No formal patient reviews."}`,
    `Patient memos:\n${memoLines || "No patient-specific memos."}`,
    `Doctor memos:\n${personalMemoLines || "No recent doctor memos."}`,
    `Graph evidence paths:\n${bundle.timeline.graphPaths
      .slice(0, 6)
      .map((path) => `${path.sourceCategory} | ${path.path.join(" -> ")} | ${path.description}`)
      .join("\n") || "No graph evidence paths."}`,
  ].join("\n\n");
}

export async function runDoctorCopilot(input: {
  doctorId: string;
  patientId: string;
  query: string;
}): Promise<DoctorCopilotAnswer> {
  const bundle = await buildEvidenceBundle(input.patientId, input.doctorId);
  const narrative = bundleNarrative(bundle);
  const aiResult = await callAi<{
    answer: string;
    evidenceSource: string;
    sourceDetails: string[];
  }>({
    routeKind: "doctor_copilot",
    system:
      "You are a doctor-side copilot. Answer only from the provided patient evidence bundle, including uploaded reports, timeline, extracted findings, and doctor memos. Do not invent findings. Return strict JSON with answer, evidenceSource, sourceDetails.",
    user: `Doctor question: ${input.query}\n\nEvidence bundle:\n${narrative}`,
    schemaName: "doctor_copilot_answer",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        answer: { type: "string" },
        evidenceSource: { type: "string" },
        sourceDetails: { type: "array", items: { type: "string" } },
      },
      required: ["answer", "evidenceSource", "sourceDetails"],
    },
  });

  const llm = aiResult?.data ?? null;
  const result: DoctorCopilotAnswer = llm
      ? {
        answer: llm.answer,
        evidenceSource: llm.evidenceSource,
        sourceDetails: llm.sourceDetails,
        graphPaths: bundle.timeline.graphPaths,
        fallback: false,
        provenance: {
          evidenceReferences: bundle.evidenceReferences,
          model: aiResult?.model || "ai-provider",
          mode: "gpt",
        },
      }
    : buildFallbackCopilotAnswer(input.query, bundle);

  recordAiReward({
    actorRole: "doctor",
    routeKind: "doctor_copilot",
    actionKey: result.fallback ? "fallback:copilot" : `${aiResult?.provider || "ai"}:copilot`,
    fallback: result.fallback,
    cacheHit: Boolean(aiResult?.cacheHit),
    evidenceCount: result.sourceDetails.length + result.graphPaths.length,
    caution: "moderate",
    answerLength: result.answer.length,
    model: result.provenance.model,
  });

  createAiAuditLog({
    doctorId: input.doctorId,
    patientId: input.patientId,
    kind: "doctor_copilot",
    model: result.provenance.model,
    fallback: result.fallback,
    evidenceRefs: result.provenance.evidenceReferences,
    response: result,
  });

  return result;
}

export async function generateDoctorDecisionReport(input: {
  doctorId: string;
  patientId: string;
}): Promise<DoctorDecisionReport> {
  const bundle = await buildEvidenceBundle(input.patientId, input.doctorId);
  const narrative = bundleNarrative(bundle);
  const aiResult = await callAi<{
    title: string;
    summary: string;
    evidenceUsed: string[];
    actionItems: string[];
    cautionPoints: string[];
    clinicianNote: string;
  }>({
    routeKind: "doctor_decision_report",
    modelTier: process.env.MINIMAX_USE_REASONING_REPORTS === "1" ? "reasoning" : "light",
    system:
      "You are a doctor decision-support writer. Use only the supplied patient evidence bundle. Return strict JSON with title, summary, evidenceUsed, actionItems, cautionPoints, clinicianNote. clinicianNote must state that final decision remains with clinician.",
    user: `Generate a concise doctor decision-support report.\n\nEvidence bundle:\n${narrative}`,
    schemaName: "doctor_decision_report",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        evidenceUsed: { type: "array", items: { type: "string" } },
        actionItems: { type: "array", items: { type: "string" } },
        cautionPoints: { type: "array", items: { type: "string" } },
        clinicianNote: { type: "string" },
      },
      required: ["title", "summary", "evidenceUsed", "actionItems", "cautionPoints", "clinicianNote"],
    },
  });

  const llm = aiResult?.data ?? null;
  const result: DoctorDecisionReport = llm
      ? {
        ...llm,
        graphPaths: bundle.timeline.graphPaths,
        fallback: false,
        provenance: {
          evidenceReferences: bundle.evidenceReferences,
          model: aiResult?.model || "ai-provider",
          mode: "gpt",
        },
      }
    : buildFallbackDecisionReport(bundle);

  recordAiReward({
    actorRole: "doctor",
    routeKind: "doctor_decision_report",
    actionKey: result.fallback ? "fallback:decision-report" : `${aiResult?.provider || "ai"}:decision-report`,
    fallback: result.fallback,
    cacheHit: Boolean(aiResult?.cacheHit),
    evidenceCount: result.evidenceUsed.length + result.graphPaths.length,
    caution: "moderate",
    answerLength: `${result.summary} ${result.actionItems.join(" ")}`.length,
    model: result.provenance.model,
  });

  createAiAuditLog({
    doctorId: input.doctorId,
    patientId: input.patientId,
    kind: "doctor_report",
    model: result.provenance.model,
    fallback: result.fallback,
    evidenceRefs: result.provenance.evidenceReferences,
    response: result,
  });

  exportDoctorPatientReportWorkbook(input.doctorId, input.patientId, result);

  return result;
}
