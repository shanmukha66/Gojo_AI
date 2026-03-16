import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { runQuery } from "@/lib/neo4j";

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "DOCTOR") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("query") || "").trim();
  const query = raw.toLowerCase();

  try {
    const results = await runQuery<{
      p: { id: string; name: string; age: number; risk?: number; signals?: string[] };
    }>(
      `
      WITH $q AS q
      MATCH (p:Patient)
      WHERE p.id IS NOT NULL AND p.id <> "undefined"
        AND (
          q = ""
          OR toLower(p.name) CONTAINS q
          OR toString(p.id) CONTAINS q
          OR p.id = q
        )
      RETURN p { .* } AS p
      LIMIT 20
      `,
      { q: query }
    );

    const patients = results
      .map((row) => row.p)
      .filter((p) => p && p.id && p.id !== "undefined")
      .map((p) => ({
        id: String(p.id),
        name: p.name,
        age: p.age ?? 0,
        risk: p.risk ?? 0,
        signals: p.signals ?? [],
      }));

    return NextResponse.json({ patients, query: raw });
  } catch (error) {
    return NextResponse.json({ error: "Failed to query Neo4j" }, { status: 500 });
  }
}
