import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";

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

  const ragUrl = `http://127.0.0.1:8008/rag?query=${encodeURIComponent(query)}&k=5`;
  const response = await fetch(ragUrl).catch((err) => {
    return new Response(`RAG server unreachable: ${err}`, { status: 503 });
  });

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json(
      { error: text || "RAG server error" },
      { status: response.status || 500 }
    );
  }

  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: text || "Invalid JSON from RAG" }, { status: 502 });
  }
}
