import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import PortalShell from "@/components/PortalShell";
import { doctorNav } from "@/lib/portalNav";

export default async function DoctorPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "DOCTOR") redirect("/patient");
  const preferences = getUserPreferences(user.id);

  return (
    <PortalShell
      badge="Doctor Home"
      eyebrow="Overview"
      title={`Welcome back, ${user.name ?? "Clinician"}`}
      description="The doctor experience now uses clearer navigation so workspace, memos, schedule, predictions, and settings each have their own place."
      navItems={doctorNav}
      initialTheme={preferences.theme}
      sidebarFooter={
        <form action="/api/auth/logout" method="post">
          <button className="btn-ghost w-full">Sign Out</button>
        </form>
      }
    >
      <section className="card-contrast stack-lg fade-up" style={{ animationDelay: "120ms" }}>
          <div className="panel-header">
            <div>
              <p className="section-title">Doctor Pages</p>
              <p className="subtle text-sm mt-2">
                Each area now has its own page so the UI feels less clumsy and more intentional during real review work.
              </p>
            </div>
            <span className="pill">Structured Navigation</span>
          </div>
          <div className="card-grid md:grid-cols-2">
            <a className="surface stack-sm" href="/doctor/patients">
              <p className="eyebrow">Patients</p>
              <p className="text-xl font-semibold mt-2">Patient charts by page</p>
              <p className="subtle text-sm">Open overview, timeline, reports, copilot, memos, and reviews without mixing them into one long workspace.</p>
            </a>
            <a className="surface stack-sm" href="/doctor/memos">
              <p className="eyebrow">Memos</p>
              <p className="text-xl font-semibold mt-2">Private notes and dictation</p>
              <p className="subtle text-sm">Keep planning notes, reminders, and dictated thoughts outside the clinical workspace.</p>
            </a>
            <a className="surface stack-sm" href="/doctor/schedule">
              <p className="eyebrow">Timetable</p>
              <p className="text-xl font-semibold mt-2">Day, week, month, year planning</p>
              <p className="subtle text-sm">Track availability and patient visits in a dedicated calendar-style view.</p>
            </a>
            <a className="surface stack-sm" href="/doctor/metrics">
              <p className="eyebrow">Predictions</p>
              <p className="text-xl font-semibold mt-2">Readable model comparison</p>
              <p className="subtle text-sm">See ROC, PR, SHAP, graph paths, and run summaries without mixing them into patient review.</p>
            </a>
            <a className="surface stack-sm" href="/doctor/settings">
              <p className="eyebrow">Settings</p>
              <p className="text-xl font-semibold mt-2">Saved preferences</p>
              <p className="subtle text-sm">Theme, chart density, and workspace behavior are now managed separately.</p>
            </a>
          </div>
        </section>
    </PortalShell>
  );
}
