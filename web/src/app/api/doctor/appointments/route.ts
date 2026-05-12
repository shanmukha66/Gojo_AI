import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { listDoctorAppointments } from "@/lib/scheduling";
import { exportDoctorAppointmentsCsv } from "@/lib/recordExports";

export async function GET() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "DOCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  exportDoctorAppointmentsCsv(user.id);
  const appointments = await listDoctorAppointments(user.id);
  return NextResponse.json({ appointments });
}
