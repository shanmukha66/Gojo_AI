import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { createDoctorAvailability, listBookableSlots, listDoctorAvailability } from "@/lib/scheduling";
import { exportDoctorAvailabilityCsv } from "@/lib/recordExports";

export async function GET() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "DOCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  exportDoctorAvailabilityCsv(user.id);
  return NextResponse.json({
    availability: listDoctorAvailability(user.id),
    upcomingSlots: listBookableSlots().filter((slot) => slot.doctorId === user.id).slice(0, 20),
  });
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "DOCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    weekday?: number;
    startTime?: string;
    endTime?: string;
    slotMinutes?: number;
    active?: boolean;
  };

  if (
    typeof body.weekday !== "number" ||
    !body.startTime ||
    !body.endTime ||
    typeof body.slotMinutes !== "number"
  ) {
    return NextResponse.json({ error: "weekday, startTime, endTime, and slotMinutes are required" }, { status: 400 });
  }

  const availability = createDoctorAvailability(user.id, {
    weekday: body.weekday,
    startTime: body.startTime,
    endTime: body.endTime,
    slotMinutes: body.slotMinutes,
    active: body.active,
  });

  return NextResponse.json({ availability }, { status: 201 });
}
