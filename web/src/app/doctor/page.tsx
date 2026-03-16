import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import DoctorDashboard from "./DoctorDashboard";

export default async function DoctorPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "DOCTOR") redirect("/patient");

  return (
    <div className="min-h-screen">
      <div className="grid-dots" />
      <div className="container-shell">
        <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">Doctor</p>
            <h1 className="text-3xl font-semibold">Welcome, {user.name ?? "Clinician"}</h1>
            <p className="subtle text-sm mt-2">
              Secondary suggestions are advisory. Final decisions remain with the clinician.
            </p>
          </div>
          <form action="/api/auth/logout" method="post">
            <button className="btn-secondary">Sign Out</button>
          </form>
        </header>
        <DoctorDashboard />
      </div>
    </div>
  );
}
