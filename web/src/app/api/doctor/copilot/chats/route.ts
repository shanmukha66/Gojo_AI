import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { deleteDoctorCopilotChat, listDoctorCopilotChats, upsertDoctorCopilotChat } from "@/lib/doctorCopilotChats";

async function requireDoctor() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "DOCTOR") return null;
  return user;
}

export async function GET() {
  const user = await requireDoctor();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ chats: listDoctorCopilotChats(user.id) });
}

export async function POST(req: Request) {
  const user = await requireDoctor();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { id?: string; chatId?: string; title?: string; messages?: unknown[] };
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const chat = upsertDoctorCopilotChat({ doctorId: user.id, chatId: body.chatId || body.id, title: body.title, messages: messages as any });
  return NextResponse.json({ chat });
}

export async function DELETE(req: Request) {
  const user = await requireDoctor();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const chatId = searchParams.get("id") || "";
  if (!chatId) return NextResponse.json({ error: "Missing chat id" }, { status: 400 });
  const deleted = deleteDoctorCopilotChat(user.id, chatId);
  return NextResponse.json({ deleted });
}
