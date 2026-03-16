import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { runQuery } from "@/lib/neo4j";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
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

  const patient = await runQuery<{
    p: { id: string; name: string; age?: number; gender?: string; risk?: number; signals?: string[] };
  }>(
    `MATCH (p:Patient {id: $id}) RETURN p { .* } AS p LIMIT 1`,
    { id }
  );

  const visits = await runQuery<{
    v: { id: string; start?: string; type?: string };
  }>(
    `MATCH (p:Patient {id: $id})-[:HAD_VISIT]->(v:Visit) RETURN v { .* } AS v ORDER BY v.start DESC LIMIT 10`,
    { id }
  );

  const conditions = await runQuery<{
    c: { code?: string };
  }>(
    `MATCH (p:Patient {id: $id})-[:HAS_CONDITION]->(c:Condition) RETURN c { .* } AS c LIMIT 10`,
    { id }
  );

  return NextResponse.json({
    patient: patient[0]?.p ?? null,
    visits: visits.map((row) => row.v),
    conditions: conditions.map((row) => row.c),
  });
}
