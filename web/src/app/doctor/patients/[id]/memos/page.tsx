import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import PortalShell from "@/components/PortalShell";
import { doctorNav } from "@/lib/portalNav";
import { getDoctorPatientBundle } from "@/lib/doctorPatientBundle";
import DoctorPatientPageFrame from "@/components/doctor/DoctorPatientPageFrame";
import DoctorPatientMemosPanel from "@/components/doctor/DoctorPatientMemosPanel";

export default async function DoctorPatientMemosPage({ params }: { params: Promise<{ id: string }> }) {
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
      badge="Patient Memos"
      eyebrow="Informal Chart Notes"
      title="Patient memos"
      description="Keep quick chart notes, reminders, and informal clinical memory separate from the formal review workflow."
      navItems={doctorNav}
      initialTheme={preferences.theme}
      headerActions={<a className="btn-secondary btn-fit" href="/doctor/patients">Back to patients</a>}
    >
      <DoctorPatientPageFrame patient={bundle.patient} activeTab="memos">
        <DoctorPatientMemosPanel patientId={bundle.patient.id} initialMemos={bundle.memos} />
      </DoctorPatientPageFrame>
    </PortalShell>
  );
}
