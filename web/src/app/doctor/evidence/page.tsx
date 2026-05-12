import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import PortalShell from "@/components/PortalShell";
import { doctorNav } from "@/lib/portalNav";
import DoctorEvidenceSearch from "@/components/DoctorEvidenceSearch";

export default async function DoctorEvidencePage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "DOCTOR") redirect("/patient");
  const preferences = getUserPreferences(user.id);

  return (
    <PortalShell
      badge="Doctor Evidence"
      eyebrow="Evidence Retrieval"
      title="Search similar patient evidence"
      description="Use retrieval on its own page so cohort evidence review does not get mixed into the active patient chart."
      navItems={doctorNav}
      initialTheme={preferences.theme}
      headerActions={
        <a className="btn-secondary" href="/doctor/patients">
          Open Patients
        </a>
      }
    >
      <DoctorEvidenceSearch />
    </PortalShell>
  );
}
