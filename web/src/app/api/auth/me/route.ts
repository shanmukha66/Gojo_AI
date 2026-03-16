import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";

export async function GET() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  return NextResponse.json({ user });
}
