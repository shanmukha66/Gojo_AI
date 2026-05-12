import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { createPatientDocumentRecord } from "@/lib/patientDocuments";
import { enqueueJob } from "@/lib/jobs";
import { runJobInBackground } from "@/lib/jobRunner";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "PATIENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file upload" }, { status: 400 });
  }

  try {
    const document = await createPatientDocumentRecord(user.id, file);
    const job = enqueueJob({
      kind: "document_process",
      ownerUserId: user.id,
      payload: { documentId: document?.id, userId: user.id, fileName: file.name },
    });

    if (!document || !job) {
      throw new Error("Unable to queue document processing");
    }
    runJobInBackground(job.id);
    return NextResponse.json({ document, job }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to upload document" },
      { status: 400 },
    );
  }
}
