import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { runQuery } from "@/lib/neo4j";
import { getUserPreferences } from "@/lib/preferences";
import DoctorSettingsForm from "@/components/DoctorSettingsForm";
import PortalShell from "@/components/PortalShell";
import { doctorNav } from "@/lib/portalNav";

export default async function DoctorSettingsPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "DOCTOR") redirect("/patient");

  const stats = await runQuery<{ c: number }>("MATCH (p:Patient) RETURN count(p) AS c");
  const patientCount = stats[0]?.c;
  const preferences = getUserPreferences(user.id);

  return (
    <PortalShell
      badge="Doctor Settings"
      brandPill="Persisted Preferences"
      eyebrow="GOJO Health App"
      title="Account & Workspace"
      description="Manage profile-level workspace settings that now persist in the application database instead of living as disabled placeholders."
      navItems={doctorNav}
      initialTheme={preferences.theme}
      headerActions={
        <a className="btn-secondary" href="/doctor/workspace">
          Open Workspace
        </a>
      }
    >
      <div className="card-contrast stack-lg fade-up" style={{ animationDelay: "120ms" }}>
          <div className="panel-header">
            <div>
              <p className="section-title">Profile</p>
              <p className="subtle text-sm mt-2">Identity details come from the authenticated account currently signed in.</p>
            </div>
          </div>
          <div className="summary-grid">
            <div className="summary-tile">
              <p className="summary-tile__label">Name</p>
              <p className="summary-tile__value text-[1.3rem]">{user.name ?? "Unavailable"}</p>
            </div>
            <div className="summary-tile">
              <p className="summary-tile__label">Email</p>
              <p className="summary-tile__value text-[1.1rem]">{user.email}</p>
            </div>
            <div className="summary-tile">
              <p className="summary-tile__label">Role</p>
              <p className="summary-tile__value text-[1.2rem]">{user.role}</p>
            </div>
          </div>
      </div>

      <DoctorSettingsForm
        initialPreferences={preferences}
        patientCountLabel={typeof patientCount === "number" ? String(patientCount) : "Unavailable"}
      />
    </PortalShell>
  );
}
