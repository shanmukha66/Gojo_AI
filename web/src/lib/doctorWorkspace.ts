import { runQuery } from "./neo4j";
import { getConceptMap } from "./omop";
import {
  getDocumentByIdForUsers,
  listPatientDocumentsByUserIds,
  type DocumentDetail,
  type PatientDocument,
} from "./patientDocuments";
import { getUserIdsForPatientRecord } from "./patientRecordLink";
import { getGraphEvidencePaths, syncExpandedKnowledgeGraphForPatient } from "./knowledgeGraph";
import { listPatientReviews } from "./patientReviews";
import { callAiJson } from "./aiProvider";
import { recordAiReward } from "./rlMetrics";

export type TimelineEvent = {
  at: string | null;
  type: "visit" | "admission" | "discharge" | "report" | "lab" | "appointment" | "review";
  title: string;
  description: string;
  sourceCategory: string;
  sourceLink: string | null;
};

export type DoctorWorkspaceDocument = DocumentDetail & {
  timelineImpact: string[];
  sourceCategory: string;
  sourceLink: string;
};

export async function getDoctorPatientCore(patientId: string) {
  const patient = await runQuery<{
    p: { id: string; name: string; age?: number; gender?: string; risk?: number; signals?: string[] };
  }>(`MATCH (p:Patient {id: $id}) RETURN p { .* } AS p LIMIT 1`, { id: patientId });

  if (!patient[0]?.p) return null;

  const visits = await runQuery<{
    v: { id: string; start?: string; end?: string; type?: string };
  }>(
    `MATCH (p:Patient {id: $id})-[:HAD_VISIT]->(v:Visit)
     RETURN v { .* } AS v
     ORDER BY v.start DESC
     LIMIT 20`,
    { id: patientId },
  );

  const conditions = await runQuery<{
    c: { code?: string };
  }>(
    `MATCH (p:Patient {id: $id})-[:HAS_CONDITION]->(c:Condition)
     RETURN c { .* } AS c
     LIMIT 20`,
    { id: patientId },
  );

  const conceptMap = await getConceptMap();

  return {
    patient: patient[0].p,
    visits: visits.map((row) => ({
      ...row.v,
      typeName: row.v.type ? conceptMap.get(String(row.v.type))?.name : undefined,
    })),
    conditions: conditions
      .map((row) => ({
        code: row.c.code,
        name: row.c.code ? conceptMap.get(String(row.c.code))?.name : undefined,
      }))
      .filter((item) => item.code && String(item.code) !== "0"),
  };
}

export async function getDoctorPatientDocuments(patientId: string) {
  const userIds = await getUserIdsForPatientRecord(patientId);
  const documents = listPatientDocumentsByUserIds(userIds);
  return {
    userIds,
    documents,
  };
}

export async function getDoctorPatientDocumentDetail(patientId: string, documentId: string): Promise<DocumentDetail | null> {
  const userIds = await getUserIdsForPatientRecord(patientId);
  return getDocumentByIdForUsers(documentId, userIds);
}

function buildVisitTimelineEvents(
  visits: Array<{ id?: string; start?: string; end?: string; type?: string; typeName?: string }>,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const visit of visits) {
    const label = visit.typeName || "Clinical visit";
    events.push({
      at: visit.start || null,
      type: "visit",
      title: label,
      description: `${label}${visit.type ? ` (${visit.type})` : ""} recorded in the synthetic EHR visit timeline.`,
      sourceCategory: "EHR Visit",
      sourceLink: visit.id ? `/doctor/patient/${visit.id}` : null,
    });

    if (/inpatient|emergency/i.test(label)) {
      events.push({
        at: visit.start || null,
        type: "admission",
        title: `Admission-linked event · ${label}`,
        description: `This encounter is treated as a higher-acuity admission-style timeline event because the visit type indicates ${label.toLowerCase()}.`,
        sourceCategory: "Derived from Visit Type",
        sourceLink: visit.id ? `/doctor/patient/${visit.id}` : null,
      });
      events.push({
        at: visit.end || visit.start || null,
        type: "discharge",
        title: `Discharge follow-up marker · ${label}`,
        description: "A matching discharge marker is added so the clinician can see the acute-care episode as a bounded timeline segment.",
        sourceCategory: "Derived from Visit Type",
        sourceLink: visit.id ? `/doctor/patient/${visit.id}` : null,
      });
    }
  }

  return events;
}

function buildDocumentTimelineEvents(documents: PatientDocument[]): TimelineEvent[] {
  return documents.flatMap((document) => {
    const reportEvent: TimelineEvent = {
      at: document.reportDate || document.createdAt || null,
      type: "report",
      title: document.fileName,
      description: `${document.status === "processed" ? "Processed" : "Uploaded"} patient report stored for clinical review.`,
      sourceCategory: "Uploaded Report",
      sourceLink: document.id,
    };

    return [reportEvent];
  });
}

function buildObservationTimelineEvents(details: DocumentDetail[]): TimelineEvent[] {
  return details.flatMap((detail) =>
    detail.observations.slice(0, 12).map((observation) => ({
      at: observation.observedAt || detail.reportDate || detail.createdAt || null,
      type: "lab" as const,
      title: observation.testName,
      description: [
        observation.valueText ? `Value ${observation.valueText}${observation.unit ? ` ${observation.unit}` : ""}` : null,
        observation.referenceRange ? `Reference ${observation.referenceRange}` : null,
        observation.abnormalFlag ? `Flag ${observation.abnormalFlag}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      sourceCategory: "Extracted Report Observation",
      sourceLink: detail.id,
    })),
  );
}

function buildReviewTimelineEvents(
  reviews: Array<{
    id: string;
    title: string;
    summary: string;
    status: string;
    updatedAt: string;
  }>,
): TimelineEvent[] {
  return reviews.map((review) => ({
    at: review.updatedAt,
    type: "review",
    title: review.title,
    description: `${review.summary}${review.status ? ` · Status ${review.status}` : ""}`,
    sourceCategory: "Doctor Review",
    sourceLink: review.id,
  }));
}

function buildDocumentTimelineImpact(detail: DocumentDetail): string[] {
  const impacts: string[] = [];

  if (detail.reportDate) {
    impacts.push(`Anchors a report event on ${detail.reportDate}.`);
  }

  if (detail.observations.length > 0) {
    const flaggedCount = detail.observations.filter((item) => item.abnormalFlag).length;
    impacts.push(
      `${detail.observations.length} structured observation${detail.observations.length === 1 ? "" : "s"} extracted for timeline review.`,
    );
    if (flaggedCount > 0) {
      impacts.push(`${flaggedCount} observation${flaggedCount === 1 ? "" : "s"} flagged for closer clinical review.`);
    }
  }

  if (detail.chunks.length > 0) {
    impacts.push(`${detail.chunks.length} retrieval chunk${detail.chunks.length === 1 ? "" : "s"} available for doctor Q&A grounding.`);
  }

  if (impacts.length === 0) {
    impacts.push("No structured findings extracted yet from this report.");
  }

  return impacts;
}

export async function getDoctorPatientReportWorkspace(patientId: string): Promise<DoctorWorkspaceDocument[]> {
  const { documents } = await getDoctorPatientDocuments(patientId);
  const details = (
    await Promise.all(documents.map((document) => getDoctorPatientDocumentDetail(patientId, document.id)))
  ).filter(Boolean) as DocumentDetail[];

  return details.map((detail) => ({
    ...detail,
    timelineImpact: buildDocumentTimelineImpact(detail),
    sourceCategory: "Uploaded Report",
    sourceLink: detail.id,
  }));
}

export async function getDoctorPatientTimeline(patientId: string, doctorId?: string) {
  const core = await getDoctorPatientCore(patientId);
  if (!core) return null;

  await syncExpandedKnowledgeGraphForPatient(patientId, doctorId);

  const { documents } = await getDoctorPatientDocuments(patientId);
  const documentDetails = await getDoctorPatientReportWorkspace(patientId);
  const graphPaths = await getGraphEvidencePaths(patientId);
  const reviews = doctorId ? listPatientReviews(doctorId, patientId) : [];

  const events = [
    ...buildVisitTimelineEvents(core.visits),
    ...buildDocumentTimelineEvents(documents),
    ...buildObservationTimelineEvents(documentDetails),
    ...buildReviewTimelineEvents(reviews),
  ]
    .sort((a, b) => {
      const aTime = a.at ? new Date(a.at).valueOf() : 0;
      const bTime = b.at ? new Date(b.at).valueOf() : 0;
      return bTime - aTime;
    })
    .slice(0, 40);

  if (events.length === 0) {
    events.push({
      at: null,
      type: "appointment",
      title: "No timeline events available",
      description: "No visit, report, or observation events are available for this patient yet.",
      sourceCategory: "Unavailable",
      sourceLink: null,
    });
  }

  return {
    patient: core.patient,
    events,
    documents,
    documentDetails,
    conditions: core.conditions,
    visits: core.visits,
    reviews,
    graphPaths,
  };
}

function scoreText(query: string, candidate: string) {
  const tokens = query.toLowerCase().split(/\W+/).filter(Boolean);
  const c = candidate.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (c.includes(token)) score += 1;
  }
  return score;
}

function buildFallbackDoctorAnswer({
  query,
  timeline,
}: {
  query: string;
  timeline: Awaited<ReturnType<typeof getDoctorPatientTimeline>>;
}) {
  if (!timeline) {
    return {
      answer: "No timeline evidence is available for this patient.",
      evidenceSource: "Unavailable",
      sourceDetails: [] as string[],
    };
  }

  const topEvents = timeline.events
    .map((event) => ({
      event,
      score: scoreText(query, `${event.title} ${event.description} ${event.sourceCategory}`),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => item.event);

  const detail = timeline.documentDetails[0];
  const reportSummary =
    detail?.observations.length
      ? `Structured findings include ${detail.observations
          .slice(0, 4)
          .map((obs) => `${obs.testName}${obs.valueText ? ` ${obs.valueText}${obs.unit ? ` ${obs.unit}` : ""}` : ""}`)
          .join(", ")}.`
      : detail?.extractedText
        ? `Report text excerpt: "${detail.extractedText.slice(0, 260)}${detail.extractedText.length > 260 ? "..." : ""}"`
        : "No uploaded report findings are linked to this patient yet.";

  return {
    answer: `For the question "${query}", the strongest available evidence points to ${topEvents
      .map((event) => `${event.title} on ${event.at || "unknown date"}`)
      .join("; ")}. ${reportSummary}`,
    evidenceSource: "Timeline events + linked uploaded reports",
    sourceDetails: topEvents.map((event) => `${event.title} · ${event.sourceCategory}`),
  };
}

async function callAiForDoctorEvidence({
  query,
  timeline,
}: {
  query: string;
  timeline: Awaited<ReturnType<typeof getDoctorPatientTimeline>>;
}) {
  if (!timeline) return null;

  const evidenceText = [
    `Patient: ${timeline.patient.name || "Patient"} (ID ${timeline.patient.id})`,
    `Timeline events:\n${timeline.events
      .slice(0, 12)
      .map((event) => `${event.at || "Unknown date"} | ${event.type} | ${event.title} | ${event.description}`)
      .join("\n")}`,
    timeline.documentDetails.length
      ? `Report details:\n${timeline.documentDetails
          .slice(0, 2)
          .map((document) => {
            const observations = document.observations
              .slice(0, 6)
              .map((obs) => `${obs.testName}${obs.valueText ? ` ${obs.valueText}${obs.unit ? ` ${obs.unit}` : ""}` : ""}${obs.abnormalFlag ? ` (${obs.abnormalFlag})` : ""}`)
              .join(", ");
            return `${document.fileName}: ${observations || document.extractedText?.slice(0, 300) || "No extracted content"}`;
          })
          .join("\n\n")}`
      : "Report details: no linked uploaded reports.",
  ].join("\n\n");

  return callAiJson<{
    answer: string;
    evidenceSource: string;
    sourceDetails: string[];
  }>({
    routeKind: "doctor_patient_evidence_qa",
    system:
      "You are a doctor-side evidence summarizer. Answer only from the provided patient timeline and linked report evidence. Do not invent findings. Return strict JSON with keys answer, evidenceSource, sourceDetails.",
    user: `Doctor question: ${query}\n\nEvidence:\n${evidenceText}`,
    schemaName: "doctor_patient_answer",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        answer: { type: "string" },
        evidenceSource: { type: "string" },
        sourceDetails: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["answer", "evidenceSource", "sourceDetails"],
    },
    temperature: 0.2,
    maxTokens: 900,
    modelTier: "light",
  });
}

export async function askDoctorPatientEvidence(patientId: string, query: string, doctorId?: string) {
  const timeline = await getDoctorPatientTimeline(patientId, doctorId);
  if (!timeline) {
    throw new Error("Patient not found");
  }

  const aiResult = await callAiForDoctorEvidence({ query, timeline });
  const llmResult = aiResult?.data ?? null;
  const fallback = buildFallbackDoctorAnswer({ query, timeline });
  const sourceDetails = [
    ...(llmResult?.sourceDetails || fallback.sourceDetails),
    ...timeline.graphPaths.slice(0, 3).map((path) => `${path.sourceCategory} · ${path.title}`),
  ];

  const result = {
    answer: llmResult?.answer || fallback.answer,
    evidenceSource: llmResult?.evidenceSource || fallback.evidenceSource,
    sourceDetails,
    graphPaths: timeline.graphPaths,
    fallback: !llmResult,
    model: llmResult ? aiResult?.model || "ai-provider" : "deterministic-fallback",
    source_mode: llmResult ? aiResult?.provider || "ai" : "fallback",
  };

  recordAiReward({
    actorRole: "doctor",
    routeKind: "doctor_patient_evidence_qa",
    actionKey: result.fallback ? "fallback:evidence-qa" : `${aiResult?.provider || "ai"}:evidence-qa`,
    fallback: result.fallback,
    cacheHit: Boolean(aiResult?.cacheHit),
    evidenceCount: result.sourceDetails.length + result.graphPaths.length,
    caution: "moderate",
    answerLength: result.answer.length,
    model: result.model,
  });

  return result;
}
