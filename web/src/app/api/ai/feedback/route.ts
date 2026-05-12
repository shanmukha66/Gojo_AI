import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { recordAiFeedback } from "@/lib/aiFeedback";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    routeKind?: string;
    chatId?: string;
    messageId?: string;
    rating?: "useful" | "too_vague" | "unsafe" | "missing_evidence" | "too_short";
    reason?: string;
    answerText?: string;
  };
  if (!body.routeKind || !body.rating) return NextResponse.json({ error: "Route and rating are required" }, { status: 400 });
  recordAiFeedback({ actorRole: user.role === "DOCTOR" ? "doctor" : "patient", actorUserId: user.id, routeKind: body.routeKind, chatId: body.chatId, messageId: body.messageId, rating: body.rating, reason: body.reason, answerText: body.answerText });
  return NextResponse.json({ ok: true });
}
