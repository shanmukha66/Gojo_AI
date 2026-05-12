import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { searchSimilarPatientEvidence } from "@/lib/localEvidenceSearch";

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "DOCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("query") || "").trim();
  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const data = await searchSimilarPatientEvidence(query, 5);
  return NextResponse.json({ ...data, source: "local_sql_neo4j_text_search" });
}
