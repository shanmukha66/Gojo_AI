import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { generateDoctorDecisionReport } from "@/lib/doctorCopilot";

export async function POST(
  _req: Request,
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

  try {
    const report = await generateDoctorDecisionReport({
      doctorId: user.id,
      patientId: id,
    });
    return NextResponse.json({ report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
