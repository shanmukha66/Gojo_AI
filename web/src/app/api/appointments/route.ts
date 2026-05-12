import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import {
  createDoctorBookedAppointment,
  createDoctorSuggestedRevisit,
  createPatientRequestedAppointment,
  listBookableSlots,
  listDoctors,
  listPatientAppointments,
} from "@/lib/scheduling";

export async function GET() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role === "PATIENT") {
    const appointments = await listPatientAppointments(user.id);
    return NextResponse.json({
      appointments,
      doctors: listDoctors(),
      availableSlots: listBookableSlots(),
    });
  }

  return NextResponse.json({ error: "Unsupported role for this endpoint" }, { status: 403 });
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    doctorId?: string;
    patientRecordId?: string;
    slotStart?: string;
    slotEnd?: string;
    reason?: string;
    revisitFromVisitId?: string;
  };

  if (!body.slotStart || !body.slotEnd || !body.reason?.trim()) {
    return NextResponse.json({ error: "slotStart, slotEnd, and reason are required" }, { status: 400 });
  }

  try {
    let appointmentId: string | null = null;
    if (user.role === "PATIENT") {
      if (!body.doctorId) {
        appointmentId = null;
      } else {
        appointmentId = await createPatientRequestedAppointment(user.id, {
          doctorId: body.doctorId,
          slotStart: body.slotStart,
          slotEnd: body.slotEnd,
          reason: body.reason.trim(),
        });
      }
    } else if (user.role === "DOCTOR" && body.patientRecordId) {
      appointmentId = body.revisitFromVisitId
        ? await createDoctorSuggestedRevisit(user.id, {
            patientRecordId: body.patientRecordId,
            slotStart: body.slotStart,
            slotEnd: body.slotEnd,
            reason: body.reason.trim(),
            revisitFromVisitId: body.revisitFromVisitId,
          })
        : await createDoctorBookedAppointment(user.id, {
            patientRecordId: body.patientRecordId,
            slotStart: body.slotStart,
            slotEnd: body.slotEnd,
            reason: body.reason.trim(),
          });
    }

    if (!appointmentId) {
      return NextResponse.json({ error: user.role === "PATIENT" ? "doctorId is required for patient booking" : "Patient record id is required for doctor-created appointments" }, { status: 400 });
    }

    return NextResponse.json({ appointmentId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create appointment";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
