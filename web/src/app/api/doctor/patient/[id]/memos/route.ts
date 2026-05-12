import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { createPatientMemo, listPatientMemos } from "@/lib/doctorMemos";
import { exportPatientMemosCsv } from "@/lib/recordExports";

export async function GET(
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
    exportPatientMemosCsv(user.id, id);
    return NextResponse.json({ memos: listPatientMemos(user.id, id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load patient memos";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

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

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
    status?: string;
    tags?: string | null;
  };

  const title = body.title?.trim();
  const content = body.body?.trim();

  if (!title || !content) {
    return NextResponse.json({ error: "Title and body are required" }, { status: 400 });
  }

  try {
    const memo = createPatientMemo(user.id, id, {
      title,
      body: content,
      status: body.status?.trim() || "open",
      tags: body.tags?.trim() || null,
    });

    return NextResponse.json({ memo }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create patient memo";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
