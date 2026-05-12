import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { deleteAppointment, rescheduleAppointment, updateAppointment } from "@/lib/scheduling";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    status?: "requested" | "booked" | "confirmed" | "completed" | "cancelled" | "rescheduled" | "revisit_suggested";
    reason?: string;
    cancellationReason?: string;
    slotStart?: string;
    slotEnd?: string;
  };

  try {
    if (body.slotStart && body.slotEnd) {
      const rescheduled = rescheduleAppointment(
        id,
        { userId: user.id, role: user.role },
        {
          slotStart: body.slotStart,
          slotEnd: body.slotEnd,
          reason: body.reason?.trim() || "Appointment rescheduled",
        },
      );
      if (!rescheduled) {
        return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
      }
      return NextResponse.json({ appointment: rescheduled.previous, replacementAppointment: rescheduled.next });
    }

    const updated = updateAppointment(
      id,
      { userId: user.id, role: user.role },
      {
        status: body.status,
        reason: body.reason?.trim(),
        cancellationReason: body.cancellationReason?.trim(),
      },
    );

    if (!updated) {
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    }

    return NextResponse.json({ appointment: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update appointment";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const deleted = deleteAppointment(id, { userId: user.id, role: user.role });
  if (!deleted) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
