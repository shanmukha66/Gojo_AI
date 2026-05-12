import { getDb } from "./db";
import { runQuery } from "./neo4j";

type PatientCandidate = {
  id: string;
  name: string;
  age: number | null;
  risk: number | null;
  description: string;
  score: number;
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
  "clinical",
  "issue",
  "problem",
  "help",
]);

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/\W+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function textScore(queryTokens: string[], text: string) {
  const lower = text.toLowerCase();
  return queryTokens.reduce((sum, token) => sum + (lower.includes(token) ? 1 : 0), 0);
}

async function loadGraphCandidates(limit = 500): Promise<PatientCandidate[]> {
  try {
    const rows = await runQuery<{ p: { id: string; name?: string; age?: number; risk?: number; description?: string; summary?: string } }>(
      `MATCH (p:Patient)
       RETURN p { .id, .name, .age, .risk, .description, .summary } AS p
       LIMIT $limit`,
      { limit },
    );
    return rows.map((row) => ({
      id: String(row.p.id),
      name: row.p.name || `Patient ${row.p.id}`,
      age: typeof row.p.age === "number" ? row.p.age : null,
      risk: typeof row.p.risk === "number" ? row.p.risk : null,
      description: row.p.description || row.p.summary || `Patient ${row.p.id}`,
      score: 0,
    }));
  } catch {
    return [];
  }
}

function loadSqlCandidates(): PatientCandidate[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT l.patient_record_id AS id,
              COALESCE(u.name, 'Patient ' || l.patient_record_id) AS name,
              GROUP_CONCAT(DISTINCT d.file_name) AS files,
              GROUP_CONCAT(DISTINCT o.test_name || ' ' || COALESCE(o.value_text, '') || ' ' || COALESCE(o.abnormal_flag, '')) AS observations,
              GROUP_CONCAT(DISTINCT a.reason || ' ' || a.status) AS appointments,
              GROUP_CONCAT(DISTINCT r.summary || ' ' || COALESCE(r.assessment, '') || ' ' || COALESCE(r.plan, '')) AS reviews
       FROM patient_record_links l
       LEFT JOIN users u ON u.id = l.user_id
       LEFT JOIN patient_documents d ON d.user_id = l.user_id
       LEFT JOIN lab_observations o ON o.document_id = d.id
       LEFT JOIN appointments a ON a.patient_record_id = l.patient_record_id
       LEFT JOIN patient_reviews r ON r.patient_record_id = l.patient_record_id
       GROUP BY l.patient_record_id
       LIMIT 700`,
    )
    .all() as Array<{ id: string; name: string; files: string | null; observations: string | null; appointments: string | null; reviews: string | null }>;

  return rows.map((row) => ({
    id: String(row.id),
    name: row.name || `Patient ${row.id}`,
    age: null,
    risk: null,
    description: [row.files, row.observations, row.appointments, row.reviews].filter(Boolean).join(". ") || `Patient ${row.id}`,
    score: 0,
  }));
}

export async function searchSimilarPatientEvidence(query: string, k = 5) {
  const tokens = tokenize(query);
  if (!tokens.length) return { results: [] };

  const [graphCandidates, sqlCandidates] = await Promise.all([loadGraphCandidates(), Promise.resolve(loadSqlCandidates())]);
  const merged = new Map<string, PatientCandidate>();
  for (const candidate of [...graphCandidates, ...sqlCandidates]) {
    const existing = merged.get(candidate.id);
    if (!existing) {
      merged.set(candidate.id, candidate);
    } else {
      merged.set(candidate.id, {
        ...existing,
        name: existing.name || candidate.name,
        age: existing.age ?? candidate.age,
        risk: existing.risk ?? candidate.risk,
        description: `${existing.description}. ${candidate.description}`,
      });
    }
  }

  const results = Array.from(merged.values())
    .map((candidate) => {
      const rawScore = textScore(tokens, `${candidate.name} ${candidate.description}`);
      const normalized = Math.min(0.99, rawScore / Math.max(3, tokens.length));
      return { ...candidate, score: normalized };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      age: candidate.age ?? 0,
      risk: candidate.risk ?? candidate.score,
      description: candidate.description.length > 520 ? `${candidate.description.slice(0, 520)}...` : candidate.description,
      score: candidate.score,
    }));

  return { results };
}
