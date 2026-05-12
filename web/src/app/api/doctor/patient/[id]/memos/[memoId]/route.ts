import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { deletePatientMemo, updatePatientMemo } from "@/lib/doctorMemos";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; memoId: string }> },
) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "DOCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, memoId } = await params;
  if (!id || id === "undefined" || !memoId) {
    return NextResponse.json({ error: "Missing identifiers" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
    status?: string;
    tags?: string | null;
  };

  try {
    const memo = updatePatientMemo(user.id, id, memoId, {
      title: body.title?.trim(),
      body: body.body?.trim(),
      status: body.status?.trim(),
      tags: body.tags === undefined ? undefined : body.tags?.trim() || null,
    });

    if (!memo) {
      return NextResponse.json({ error: "Memo not found" }, { status: 404 });
    }

    return NextResponse.json({ memo });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update patient memo";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; memoId: string }> },
) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "DOCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, memoId } = await params;
  if (!id || id === "undefined" || !memoId) {
    return NextResponse.json({ error: "Missing identifiers" }, { status: 400 });
  }

  try {
    const deleted = deletePatientMemo(user.id, id, memoId);
    if (!deleted) {
      return NextResponse.json({ error: "Memo not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete patient memo";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
