import { NextResponse } from "next/server";
import {
  createUser,
  hashPassword,
  findUserByEmail,
  createSession,
  SESSION_COOKIE,
} from "@/lib/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, email, password, role } = body as {
    name?: string;
    email?: string;
    password?: string;
    role?: "DOCTOR" | "PATIENT";
  };

  if (!email || !password || !role) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!email.includes("@") || password.length < 8) {
    return NextResponse.json({ error: "Invalid email or password too short" }, { status: 400 });
  }

  if (role !== "DOCTOR" && role !== "PATIENT") {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const existing = findUserByEmail(email);
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const userId = createUser({ name: name ?? null, email, passwordHash, role });
  const sessionId = createSession(userId);

  const response = NextResponse.json({ ok: true, role });
  response.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
