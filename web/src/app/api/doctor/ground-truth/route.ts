import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { createGroundTruthSource, listGroundTruthSources, setGroundTruthSourceActive } from "@/lib/groundTruthLibrary";

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
  return NextResponse.json({ sources: listGroundTruthSources() });
}

export async function POST(req: Request) {
  const user = await requireDoctor();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { title?: string; sourceType?: string; specialty?: string; tags?: string; content?: string };
  if (!body.title?.trim() || !body.content?.trim()) {
    return NextResponse.json({ error: "Title and content are required" }, { status: 400 });
  }
  const id = createGroundTruthSource({ ownerUserId: user.id, title: body.title, sourceType: body.sourceType || "manual", specialty: body.specialty, tags: body.tags, content: body.content });
  return NextResponse.json({ id });
}

export async function PATCH(req: Request) {
  const user = await requireDoctor();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { id?: string; active?: boolean };
  if (!body.id) return NextResponse.json({ error: "Missing source id" }, { status: 400 });
  const ok = setGroundTruthSourceActive({ actorUserId: user.id, id: body.id, active: Boolean(body.active) });
  return NextResponse.json({ ok });
}
