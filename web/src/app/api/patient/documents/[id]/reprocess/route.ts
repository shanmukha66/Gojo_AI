import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { enqueueJob } from "@/lib/jobs";
import { runJobInBackground } from "@/lib/jobRunner";

export const runtime = "nodejs";

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "PATIENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  try {
    const job = enqueueJob({
      kind: "document_reprocess",
      ownerUserId: user.id,
      payload: { documentId: id, userId: user.id },
    });
    if (!job) {
      throw new Error("Unable to queue document reprocess job");
    }
    runJobInBackground(job.id);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to reprocess document" },
      { status: 400 },
    );
  }
}
