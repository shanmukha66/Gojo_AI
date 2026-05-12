import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import PortalShell from "@/components/PortalShell";
import { patientNav } from "@/lib/portalNav";

export default async function PatientPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "PATIENT") redirect("/doctor");
  const preferences = getUserPreferences(user.id);

  return (
    <PortalShell
      badge="Patient Home"
      eyebrow="Overview"
      title={`Welcome, ${user.name ?? "Friend"}`}
      description="The patient experience now uses clearer navigation so assistant, reports, appointments, and settings each feel simple and readable."
      navItems={patientNav}
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
              <p className="section-title">Patient Pages</p>
              <p className="subtle text-sm mt-2">
                The main patient areas are separated now so the UI feels less heavy and each task is easier to understand.
              </p>
            </div>
            <span className="pill">Clean Navigation</span>
          </div>
          <div className="card-grid md:grid-cols-2">
            <a className="surface stack-sm" href="/patient/assistant">
              <p className="eyebrow">Assistant</p>
              <p className="text-xl font-semibold mt-2">Ask first-aid and report questions</p>
              <p className="subtle text-sm">Use typed or voice-to-text input and get grounded answers in one focused page.</p>
            </a>
            <a className="surface stack-sm" href="/patient/reports">
              <p className="eyebrow">Reports</p>
              <p className="text-xl font-semibold mt-2">Upload and inspect medical documents</p>
              <p className="subtle text-sm">See extracted text, structured findings, and processing status without crowding the assistant.</p>
            </a>
            <a className="surface stack-sm" href="/patient/appointments">
              <p className="eyebrow">Appointments</p>
              <p className="text-xl font-semibold mt-2">Book and track visits</p>
              <p className="subtle text-sm">Choose available slots and monitor request status on a dedicated page.</p>
            </a>
            <a className="surface stack-sm" href="/patient/settings">
              <p className="eyebrow">Settings</p>
              <p className="text-xl font-semibold mt-2">Saved preferences</p>
              <p className="subtle text-sm">Adjust theme and assistant behavior without mixing it into daily tasks.</p>
            </a>
          </div>
        </section>
    </PortalShell>
  );
}
