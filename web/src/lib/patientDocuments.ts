import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import os from "os";
import { getDb } from "./db";

export type DocumentStatus = "uploaded" | "processed" | "failed";

export type PatientDocument = {
  id: string;
  userId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  status: DocumentStatus;
  extractionError: string | null;
  reportDate: string | null;
  extractionVersion: number;
  parserVersion: number;
  reportVersion: number;
  interpretationVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type DocumentChunk = {
  id: string;
  chunkIndex: number;
  content: string;
};

export type LabObservation = {
  id: string;
  testName: string;
  valueText: string | null;
  numericValue: number | null;
  unit: string | null;
  referenceRange: string | null;
  abnormalFlag: string | null;
  observedAt: string | null;
};

export type DocumentDetail = PatientDocument & {
  extractedText: string | null;
  chunks: DocumentChunk[];
  observations: LabObservation[];
};

const UPLOAD_ROOT = process.env.DOCUMENT_UPLOAD_PATH || path.join(process.cwd(), "data", "uploads");
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

function nowIso() {
  return new Date().toISOString();
}

function ensureUploadDir(userId: string) {
  const dir = path.join(UPLOAD_ROOT, userId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeFileExtension(fileName: string, mimeType: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext) return ext;
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  return ".jpg";
}

function buildStoredName(documentId: string, originalName: string, mimeType: string) {
  return `${documentId}${normalizeFileExtension(originalName, mimeType)}`;
}

function cleanText(value: string) {
  return value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitIntoChunks(text: string, maxLength = 800) {
  if (!text.trim()) return [];

  const paragraphs = text
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }
    if (`${current}\n\n${paragraph}`.length <= maxLength) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }
    chunks.push(current);
    current = paragraph;
  }

  if (current) chunks.push(current);

  if (chunks.length === 0) {
    const lines = text.split("\n").map((item) => item.trim()).filter(Boolean);
    return lines.reduce<string[]>((acc, line) => {
      const last = acc.at(-1) ?? "";
      if (!last || `${last} ${line}`.length > maxLength) {
        acc.push(line);
      } else {
        acc[acc.length - 1] = `${last} ${line}`.trim();
      }
      return acc;
    }, []);
  }

  return chunks;
}

function extractDate(text: string) {
  const patterns = [
    /\b(\d{4}-\d{2}-\d{2})\b/,
    /\b(\d{2}\/\d{2}\/\d{4})\b/,
    /\b([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const maybeDate = new Date(match[1]);
      if (!Number.isNaN(maybeDate.valueOf())) {
        return maybeDate.toISOString().slice(0, 10);
      }
      return match[1];
    }
  }

  return null;
}

function detectAbnormalFlag(raw?: string) {
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized === "h" || normalized === "high") return "high";
  if (normalized === "l" || normalized === "low") return "low";
  if (normalized === "abnormal") return "abnormal";
  if (normalized === "normal") return "normal";
  return raw;
}

function extractObservations(text: string, reportDate: string | null) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const observations: Omit<LabObservation, "id">[] = [];
  const pattern =
    /^([A-Za-z][A-Za-z0-9 ,()%/+._-]{2,}?)\s+(-?\d+(?:\.\d+)?)\s*([A-Za-z%/µμ^0-9._-]{0,20})?(?:\s+(\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:\s*[A-Za-z%/µμ^0-9._-]+)?))?(?:\s+(H|L|High|Low|Normal|Abnormal))?$/i;

  for (const line of lines) {
    const match = line.match(pattern);
    if (!match?.[1] || !match?.[2]) continue;

    const [, name, value, unit, range, flag] = match;
    const numericValue = Number(value);
    observations.push({
      testName: name.trim(),
      valueText: value.trim(),
      numericValue: Number.isFinite(numericValue) ? numericValue : null,
      unit: unit?.trim() || null,
      referenceRange: range?.trim() || null,
      abnormalFlag: detectAbnormalFlag(flag),
      observedAt: reportDate,
    });
  }

  return observations.slice(0, 50);
}

function extractPdfText(storagePath: string) {
  try {
    const output = execFileSync("pdftotext", ["-layout", storagePath, "-"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return cleanText(output);
  } catch {
    return "";
  }
}

function extractImageText(storagePath: string) {
  try {
    const output = execFileSync("tesseract", [storagePath, "stdout", "--psm", "6"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return cleanText(output);
  } catch {
    return "";
  }
}

function extractScannedPdfText(storagePath: string) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gojo-pdf-ocr-"));
  const imagePrefix = path.join(tempRoot, "page");
  try {
    execFileSync("pdftoppm", ["-f", "1", "-singlefile", "-png", storagePath, imagePrefix], {
      maxBuffer: 16 * 1024 * 1024,
    });
    const imagePath = `${imagePrefix}.png`;
    if (!fs.existsSync(imagePath)) return "";
    return extractImageText(imagePath);
  } catch {
    return "";
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function extractText(storagePath: string, mimeType: string) {
  if (mimeType === "application/pdf") {
    const directText = extractPdfText(storagePath);
    if (directText) return directText;
    return extractScannedPdfText(storagePath);
  }
  return extractImageText(storagePath);
}

function mapDocumentRow(row: {
  id: string;
  user_id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  status: DocumentStatus;
  extraction_error: string | null;
  report_date: string | null;
  extraction_version: number;
  parser_version: number;
  report_version: number;
  interpretation_version: number;
  created_at: string;
  updated_at: string;
}): PatientDocument {
  return {
    id: row.id,
    userId: row.user_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    status: row.status,
    extractionError: row.extraction_error,
    reportDate: row.report_date,
    extractionVersion: Number(row.extraction_version),
    parserVersion: Number(row.parser_version),
    reportVersion: Number(row.report_version),
    interpretationVersion: Number(row.interpretation_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isSupportedDocumentType(mimeType: string) {
  return SUPPORTED_MIME_TYPES.has(mimeType);
}

export async function createPatientDocumentRecord(userId: string, file: File) {
  if (!isSupportedDocumentType(file.type)) {
    throw new Error("Unsupported file type. Please upload a PDF, PNG, or JPEG report.");
  }

  const documentId = crypto.randomUUID();
  const storedName = buildStoredName(documentId, file.name, file.type);
  const storageDir = ensureUploadDir(userId);
  const storagePath = path.join(storageDir, storedName);
  const arrayBuffer = await file.arrayBuffer();
  fs.writeFileSync(storagePath, Buffer.from(arrayBuffer));

  const db = getDb();
  const now = nowIso();
  db.prepare(
    `INSERT INTO patient_documents
      (id, user_id, file_name, stored_name, mime_type, file_size, status, extraction_error, storage_path, extracted_text, report_date,
       extraction_version, parser_version, report_version, interpretation_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, ?, ?)`
  ).run(
    documentId,
    userId,
    file.name,
    storedName,
    file.type,
    file.size,
    "uploaded",
    null,
    storagePath,
    null,
    null,
    now,
    now
  );

  return getPatientDocument(documentId, userId);
}

export async function createPatientDocument(userId: string, file: File) {
  const document = await createPatientDocumentRecord(userId, file);
  if (!document) {
    throw new Error("Unable to create document record");
  }
  return processPatientDocument(document.id, userId);
}

export function listPatientDocuments(userId: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, user_id, file_name, mime_type, file_size, status, extraction_error, report_date,
              extraction_version, parser_version, report_version, interpretation_version, created_at, updated_at
       FROM patient_documents
       WHERE user_id = ?
       ORDER BY created_at DESC`
    )
    .all(userId) as Array<{
      id: string;
      user_id: string;
      file_name: string;
      mime_type: string;
      file_size: number;
      status: DocumentStatus;
      extraction_error: string | null;
      report_date: string | null;
      extraction_version: number;
      parser_version: number;
      report_version: number;
      interpretation_version: number;
      created_at: string;
      updated_at: string;
    }>;

  return rows.map(mapDocumentRow);
}

export function listPatientDocumentsByUserIds(userIds: string[]) {
  if (userIds.length === 0) return [];
  const db = getDb();
  const placeholders = userIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT id, user_id, file_name, mime_type, file_size, status, extraction_error, report_date,
              extraction_version, parser_version, report_version, interpretation_version, created_at, updated_at
       FROM patient_documents
       WHERE user_id IN (${placeholders})
       ORDER BY created_at DESC`
    )
    .all(...userIds) as Array<{
      id: string;
      user_id: string;
      file_name: string;
      mime_type: string;
      file_size: number;
      status: DocumentStatus;
      extraction_error: string | null;
      report_date: string | null;
      extraction_version: number;
      parser_version: number;
      report_version: number;
      interpretation_version: number;
      created_at: string;
      updated_at: string;
    }>;
  return rows.map(mapDocumentRow);
}

export function getPatientDocument(documentId: string, userId: string): DocumentDetail | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, user_id, file_name, mime_type, file_size, status, extraction_error, report_date,
              extraction_version, parser_version, report_version, interpretation_version, created_at, updated_at, extracted_text
       FROM patient_documents
       WHERE id = ? AND user_id = ?`
    )
    .get(documentId, userId) as
    | {
        id: string;
        user_id: string;
        file_name: string;
        mime_type: string;
        file_size: number;
        status: DocumentStatus;
        extraction_error: string | null;
        report_date: string | null;
        extraction_version: number;
        parser_version: number;
        report_version: number;
        interpretation_version: number;
        created_at: string;
        updated_at: string;
        extracted_text: string | null;
      }
    | undefined;

  if (!row) return null;

  const chunks = db
    .prepare(
      `SELECT id, chunk_index, content
       FROM document_chunks
       WHERE document_id = ?
       ORDER BY chunk_index ASC`
    )
    .all(documentId) as Array<{ id: string; chunk_index: number; content: string }>;

  const observations = db
    .prepare(
      `SELECT id, test_name, value_text, numeric_value, unit, reference_range, abnormal_flag, observed_at
       FROM lab_observations
       WHERE document_id = ?
       ORDER BY created_at ASC`
    )
    .all(documentId) as Array<{
      id: string;
      test_name: string;
      value_text: string | null;
      numeric_value: number | null;
      unit: string | null;
      reference_range: string | null;
      abnormal_flag: string | null;
      observed_at: string | null;
    }>;

  return {
    ...mapDocumentRow(row),
    extractedText: row.extracted_text,
    chunks: chunks.map((chunk) => ({
      id: chunk.id,
      chunkIndex: Number(chunk.chunk_index),
      content: chunk.content,
    })),
    observations: observations.map((observation) => ({
      id: observation.id,
      testName: observation.test_name,
      valueText: observation.value_text,
      numericValue: observation.numeric_value,
      unit: observation.unit,
      referenceRange: observation.reference_range,
      abnormalFlag: observation.abnormal_flag,
      observedAt: observation.observed_at,
    })),
  };
}

export function processPatientDocument(documentId: string, userId: string) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, user_id, file_name, mime_type, file_size, status, extraction_error, storage_path,
              extraction_version, parser_version, report_version, interpretation_version, created_at, updated_at
       FROM patient_documents
       WHERE id = ? AND user_id = ?`
    )
    .get(documentId, userId) as
    | {
        id: string;
        user_id: string;
        file_name: string;
        mime_type: string;
        file_size: number;
        status: DocumentStatus;
        extraction_error: string | null;
        storage_path: string;
        extraction_version: number;
        parser_version: number;
        report_version: number;
        interpretation_version: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    throw new Error("Document not found");
  }

  let extractedText = extractText(row.storage_path, row.mime_type);
  let status: DocumentStatus = "processed";
  let extractionError: string | null = null;

  if (!extractedText) {
    status = "failed";
    extractionError =
      row.mime_type === "application/pdf"
        ? "Unable to extract text from this PDF. If it is scanned, image-based OCR support can be added in the next iteration."
        : "Unable to extract OCR text from this image.";
    extractedText = "";
  }

  const reportDate = extractedText ? extractDate(extractedText) : null;
  const chunks = extractedText ? splitIntoChunks(extractedText) : [];
  const observations = extractedText ? extractObservations(extractedText, reportDate) : [];
  const updatedAt = nowIso();
  const extractionVersion = Number(row.extraction_version || 0) + 1;
  const parserVersion = Number(row.parser_version || 0) + 1;
  const reportVersion = Number(row.report_version || 0) + 1;
  const interpretationVersion = Number(row.interpretation_version || 0) + 1;

  db.prepare("DELETE FROM document_chunks WHERE document_id = ?").run(documentId);
  db.prepare("DELETE FROM lab_observations WHERE document_id = ?").run(documentId);

  if (chunks.length) {
    const insertChunk = db.prepare(
      "INSERT INTO document_chunks (id, document_id, chunk_index, content, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const insertMany = db.transaction((items: string[]) => {
      items.forEach((content, index) => {
        insertChunk.run(crypto.randomUUID(), documentId, index, content, updatedAt);
      });
    });
    insertMany(chunks);
  }

  if (observations.length) {
    const insertObservation = db.prepare(
      `INSERT INTO lab_observations
        (id, document_id, user_id, test_name, value_text, numeric_value, unit, reference_range, abnormal_flag, observed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertMany = db.transaction((items: Omit<LabObservation, "id">[]) => {
      items.forEach((observation) => {
        insertObservation.run(
          crypto.randomUUID(),
          documentId,
          userId,
          observation.testName,
          observation.valueText,
          observation.numericValue,
          observation.unit,
          observation.referenceRange,
          observation.abnormalFlag,
          observation.observedAt,
          updatedAt
        );
      });
    });
    insertMany(observations);
  }

  db.prepare(
    `UPDATE patient_documents
      SET status = ?, extraction_error = ?, extracted_text = ?, report_date = ?,
          extraction_version = ?, parser_version = ?, report_version = ?, interpretation_version = ?, updated_at = ?
      WHERE id = ?`
  ).run(
    status,
    extractionError,
    extractedText || null,
    reportDate,
    extractionVersion,
    parserVersion,
    reportVersion,
    interpretationVersion,
    updatedAt,
    documentId,
  );

  return getPatientDocument(documentId, userId);
}

export function getDocumentByIdForUsers(documentId: string, userIds: string[]) {
  if (userIds.length === 0) return null;
  const detail = userIds
    .map((userId) => getPatientDocument(documentId, userId))
    .find(Boolean);
  return detail ?? null;
}
