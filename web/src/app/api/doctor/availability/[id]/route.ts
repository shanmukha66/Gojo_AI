import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { deleteDoctorAvailability } from "@/lib/scheduling";

export async function DELETE(
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
  if (!id) {
    return NextResponse.json({ error: "Missing availability id" }, { status: 400 });
  }

  const deleted = deleteDoctorAvailability(user.id, id);
  if (!deleted) {
    return NextResponse.json({ error: "Availability block not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
