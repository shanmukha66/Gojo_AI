import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import PatientAssistant from "./PatientAssistant";

export default async function PatientPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "PATIENT") redirect("/doctor");

  return (
    <div className="min-h-screen">
      <div className="grid-dots" />
      <div className="container-shell">
        <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Patient</p>
            <h1 className="text-3xl font-semibold">Welcome, {user.name ?? "Friend"}</h1>
            <p className="subtle text-sm mt-2">
              This assistant offers general first‑aid guidance and does not replace professional care.
            </p>
          </div>
          <form action="/api/auth/logout" method="post">
            <button className="btn-secondary">Sign Out</button>
          </form>
        </header>
        <PatientAssistant />
      </div>
    </div>
  );
}
