import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { listJobsForOwner } from "@/lib/jobs";

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const kinds = searchParams.getAll("kind").filter(Boolean);
  return NextResponse.json({ jobs: listJobsForOwner(user.id, kinds.length > 0 ? kinds : undefined) });
}
