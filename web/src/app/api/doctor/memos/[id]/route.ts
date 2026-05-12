import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { deleteDoctorMemo, updateDoctorMemo } from "@/lib/doctorMemos";

export async function PATCH(
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
  if (!id) {
    return NextResponse.json({ error: "Missing memo id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
    type?: string;
    tags?: string | null;
  };

  const memo = updateDoctorMemo(user.id, id, {
    title: body.title?.trim(),
    body: body.body?.trim(),
    type: body.type?.trim(),
    tags: body.tags === undefined ? undefined : body.tags?.trim() || null,
  });

  if (!memo) {
    return NextResponse.json({ error: "Memo not found" }, { status: 404 });
  }

  return NextResponse.json({ memo });
}

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
    return NextResponse.json({ error: "Missing memo id" }, { status: 400 });
  }

  const deleted = deleteDoctorMemo(user.id, id);
  if (!deleted) {
    return NextResponse.json({ error: "Memo not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
