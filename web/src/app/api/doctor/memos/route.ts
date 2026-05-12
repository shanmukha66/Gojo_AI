import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { createDoctorMemo, listDoctorMemos } from "@/lib/doctorMemos";
import { exportDoctorMemosCsv } from "@/lib/recordExports";

export async function GET() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "DOCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  exportDoctorMemosCsv(user.id);
  return NextResponse.json({ memos: listDoctorMemos(user.id) });
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "DOCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
    type?: string;
    tags?: string | null;
  };

  const title = body.title?.trim();
  const content = body.body?.trim();

  if (!title || !content) {
    return NextResponse.json({ error: "Title and body are required" }, { status: 400 });
  }

  const memo = createDoctorMemo(user.id, {
    title,
    body: content,
    type: body.type?.trim() || "general",
    tags: body.tags?.trim() || null,
  });

  return NextResponse.json({ memo }, { status: 201 });
}
