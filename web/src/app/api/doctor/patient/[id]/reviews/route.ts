import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { createPatientReview, listPatientReviews } from "@/lib/patientReviews";

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

  try {
    const { id } = await params;
    return NextResponse.json({ reviews: listPatientReviews(user.id, id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load patient reviews";
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

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    summary?: string;
    assessment?: string | null;
    plan?: string | null;
    followUp?: string | null;
    revisitRecommended?: boolean;
    status?: string;
    tags?: string | null;
    patientUserId?: string | null;
    visitId?: string | null;
    appointmentId?: string | null;
  };

  if (!body.title?.trim() || !body.summary?.trim()) {
    return NextResponse.json({ error: "Title and summary are required" }, { status: 400 });
  }

  try {
    const { id } = await params;
    const review = createPatientReview({
      doctorId: user.id,
      patientRecordId: id,
      patientUserId: body.patientUserId ?? null,
      visitId: body.visitId ?? null,
      appointmentId: body.appointmentId ?? null,
      title: body.title.trim(),
      summary: body.summary.trim(),
      assessment: body.assessment?.trim() || null,
      plan: body.plan?.trim() || null,
      followUp: body.followUp?.trim() || null,
      revisitRecommended: Boolean(body.revisitRecommended),
      status: body.status?.trim() || "draft",
      tags: body.tags?.trim() || null,
    });
    return NextResponse.json({ review }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create patient review";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
