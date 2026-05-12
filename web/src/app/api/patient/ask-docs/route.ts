import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { answerPatientDocuments } from "@/lib/patientChat";

const bodySchema = z.object({
  query: z.string().min(1),
  documentId: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "PATIENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const result = await answerPatientDocuments({
    userId: user.id,
    query: parsed.data.query,
    documentId: parsed.data.documentId,
  });

  return NextResponse.json(result);
}
