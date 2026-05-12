import { getJob, listJobsForOwner, markJobCompleted, markJobFailed, markJobRunning } from "./jobs";
import { processPatientDocument } from "./patientDocuments";

async function executeJob(jobId: string) {
  const job = getJob(jobId);
  if (!job || job.status === "running") return null;

  markJobRunning(jobId);
  const fresh = getJob(jobId);
  if (!fresh) return null;

  try {
    const payload = JSON.parse(fresh.payloadJson || "{}") as Record<string, unknown>;

    if (fresh.kind === "document_process" || fresh.kind === "document_reprocess") {
      const documentId = typeof payload.documentId === "string" ? payload.documentId : null;
      const userId = typeof payload.userId === "string" ? payload.userId : null;
      if (!documentId || !userId) {
        throw new Error("Job payload is missing document context.");
      }
      const document = processPatientDocument(documentId, userId);
      markJobCompleted(jobId, { documentId, status: document?.status || "processed" });
      return document;
    }

    markJobCompleted(jobId, { ok: true, handled: false, kind: fresh.kind });
    return null;
  } catch (error) {
    markJobFailed(jobId, error instanceof Error ? error.message : "Job execution failed");
    throw error;
  }
}

export function runJobInBackground(jobId: string) {
  queueMicrotask(() => {
    void executeJob(jobId);
  });
}

export async function runPendingJobsForOwner(ownerUserId: string) {
  const jobs = listJobsForOwner(ownerUserId).filter((job) => job.status === "queued");
  for (const job of jobs) {
    await executeJob(job.id);
  }
  return jobs.length;
}
