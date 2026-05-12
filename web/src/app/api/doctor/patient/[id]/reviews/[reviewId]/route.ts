import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { deletePatientReview, updatePatientReview } from "@/lib/patientReviews";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; reviewId: string }> },
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
  };

  try {
    const { reviewId } = await params;
    const review = updatePatientReview(user.id, reviewId, {
      title: body.title?.trim(),
      summary: body.summary?.trim(),
      assessment: body.assessment?.trim() || null,
      plan: body.plan?.trim() || null,
      followUp: body.followUp?.trim() || null,
      revisitRecommended: body.revisitRecommended,
      status: body.status?.trim(),
      tags: body.tags?.trim() || null,
    });
    if (!review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }
    return NextResponse.json({ review });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update patient review";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; reviewId: string }> },
) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "DOCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { reviewId } = await params;
    const deleted = deletePatientReview(user.id, reviewId);
    if (!deleted) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete patient review";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
