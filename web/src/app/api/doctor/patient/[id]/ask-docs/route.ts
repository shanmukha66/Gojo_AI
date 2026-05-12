import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { askDoctorPatientEvidence } from "@/lib/doctorWorkspace";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "DOCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id || id === "undefined") {
    return NextResponse.json({ error: "Missing patient id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { query?: string };
  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing question" }, { status: 400 });
  }

  try {
    const result = await askDoctorPatientEvidence(id, query, user.id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to answer question";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
