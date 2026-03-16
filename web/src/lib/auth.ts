import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getDb } from "./db";

export const SESSION_COOKIE = "aegis_session";
const SESSION_TTL_DAYS = 7;

export type Role = "DOCTOR" | "PATIENT" | "ADMIN";

export type User = {
  id: string;
  name: string | null;
  email: string;
  role: Role;
};

function nowIso() {
  return new Date().toISOString();
}

function expiresAtIso() {
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_TTL_DAYS);
  return expires.toISOString();
}

export async function hashPassword(password: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function createSession(userId: string) {
  const sessionId = crypto.randomUUID();
  const db = getDb();
  db.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)"
  ).run(sessionId, userId, expiresAtIso());
  return sessionId;
}

export function destroySession(sessionId?: string | null) {
  if (!sessionId) return;
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function getCurrentUser(sessionId?: string | null): User | null {
  if (!sessionId) return null;

  const db = getDb();
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(sessionId) as { id: string; user_id: string; expires_at: string } | undefined;

  if (!session) return null;

  if (new Date(session.expires_at) < new Date()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    return null;
  }

  const user = db
    .prepare("SELECT id, name, email, role FROM users WHERE id = ?")
    .get(session.user_id) as User | undefined;

  return user ?? null;
}

export function requireRole(role: Role, sessionId?: string | null) {
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== role) return null;
  return user;
}

export function createUser({
  name,
  email,
  passwordHash,
  role,
}: {
  name?: string | null;
  email: string;
  passwordHash: string;
  role: Role;
}) {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, name ?? null, email.toLowerCase(), passwordHash, role, nowIso());
  return id;
}

export function findUserByEmail(email: string) {
  const db = getDb();
  return db
    .prepare("SELECT id, name, email, role, password_hash FROM users WHERE email = ?")
    .get(email.toLowerCase()) as
    | (User & { password_hash: string })
    | undefined;
}
