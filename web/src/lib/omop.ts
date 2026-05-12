import fs from "fs";
import path from "path";
import readline from "readline";

type ConceptEntry = {
  id: string;
  name: string;
  domain?: string;
  vocabulary?: string;
  conceptClass?: string;
};

let conceptMapPromise: Promise<Map<string, ConceptEntry>> | null = null;

const FALLBACK_CONCEPTS: ConceptEntry[] = [
  { id: "9201", name: "Emergency Room Visit", domain: "Visit" },
  { id: "9202", name: "Outpatient Visit", domain: "Visit" },
  { id: "9203", name: "Inpatient Visit", domain: "Visit" },
  { id: "581477", name: "Office Visit", domain: "Visit" },
  { id: "581458", name: "Urgent Care Visit", domain: "Visit" },
];

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function loadConceptMap(): Promise<Map<string, ConceptEntry>> {
  const datasetDir = process.env.SYNTH_OMOP_DIR || "/Volumes/workspace/Explainable-AI-RAG-Framework/datasets/synthea_omop_100k";
  const conceptPath = path.join(datasetDir, "concept.csv");

  const map = new Map<string, ConceptEntry>();
  for (const concept of FALLBACK_CONCEPTS) {
    map.set(concept.id, concept);
  }
  if (!fs.existsSync(conceptPath)) {
    return map;
  }
  const stream = fs.createReadStream(conceptPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let header: string[] | null = null;
  let idx: Record<string, number> = {};

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      idx = {
        concept_id: header.indexOf("concept_id"),
        concept_name: header.indexOf("concept_name"),
        domain_id: header.indexOf("domain_id"),
        vocabulary_id: header.indexOf("vocabulary_id"),
        concept_class_id: header.indexOf("concept_class_id"),
      };
      continue;
    }

    const cols = parseCsvLine(line);
    const id = cols[idx.concept_id];
    const name = cols[idx.concept_name];
    if (!id || !name) continue;

    map.set(String(id), {
      id: String(id),
      name,
      domain: cols[idx.domain_id],
      vocabulary: cols[idx.vocabulary_id],
      conceptClass: cols[idx.concept_class_id],
    });
  }

  return map;
}

export async function getConceptMap() {
  if (!conceptMapPromise) {
    conceptMapPromise = loadConceptMap();
  }
  return conceptMapPromise;
}

export async function lookupConceptName(code?: string | number) {
  if (code === undefined || code === null) return undefined;
  const map = await getConceptMap();
  return map.get(String(code))?.name;
}
