import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import PatientSettingsForm from "@/components/PatientSettingsForm";
import PortalShell from "@/components/PortalShell";
import { patientNav } from "@/lib/portalNav";

export default async function PatientSettingsPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "PATIENT") redirect("/doctor");

  const preferences = getUserPreferences(user.id);

  return (
    <PortalShell
      badge="Patient Settings"
      brandPill="Persisted Preferences"
      eyebrow="GOJO Health App"
      title="Account & Preferences"
      description="Set how the patient assistant feels, looks, and behaves. These preferences now save to the application database for this account."
      navItems={patientNav}
      initialTheme={preferences.theme}
      headerActions={
        <a className="btn-secondary" href="/patient/assistant">
          Open Assistant
        </a>
      }
    >
      <div className="card-contrast stack-lg fade-up" style={{ animationDelay: "120ms" }}>
          <div className="panel-header">
            <div>
              <p className="section-title">Profile</p>
              <p className="subtle text-sm mt-2">Identity details are loaded from the signed-in patient account.</p>
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

      <PatientSettingsForm initialPreferences={preferences} />
    </PortalShell>
  );
}
