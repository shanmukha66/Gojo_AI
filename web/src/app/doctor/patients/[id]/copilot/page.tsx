import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import PortalShell from "@/components/PortalShell";
import { doctorNav } from "@/lib/portalNav";
import { getDoctorPatientBundle } from "@/lib/doctorPatientBundle";
import DoctorPatientPageFrame from "@/components/doctor/DoctorPatientPageFrame";
import DoctorPatientCopilotPanel from "@/components/doctor/DoctorPatientCopilotPanel";

export default async function DoctorPatientCopilotPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "DOCTOR") redirect("/patient");
  const preferences = getUserPreferences(user.id);
  const { id } = await params;
  const bundle = await getDoctorPatientBundle(user.id, id);
  if (!bundle) redirect("/doctor/patients");

  return (
    <PortalShell
      badge="Patient Copilot"
      eyebrow="Grounded Q&A"
      title="Copilot and decision support"
      description="Keep clinician Q&A and synthesized report generation on their own page so answers stay readable and action-focused."
      navItems={doctorNav}
      initialTheme={preferences.theme}
      headerActions={<a className="btn-secondary btn-fit" href="/doctor/patients">Back to patients</a>}
    >
      <DoctorPatientPageFrame patient={bundle.patient} activeTab="copilot">
        <DoctorPatientCopilotPanel patientId={bundle.patient.id} />
      </DoctorPatientPageFrame>
    </PortalShell>
  );
}
