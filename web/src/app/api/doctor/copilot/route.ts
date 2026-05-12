import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { runDoctorCopilot } from "@/lib/doctorCopilot";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "DOCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    patientId?: string;
    query?: string;
  };
  const patientId = body.patientId?.trim();
  const query = body.query?.trim();

  if (!patientId || !query) {
    return NextResponse.json({ error: "patientId and query are required" }, { status: 400 });
  }

  try {
    const result = await runDoctorCopilot({
      doctorId: user.id,
      patientId,
      query,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run doctor copilot";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
