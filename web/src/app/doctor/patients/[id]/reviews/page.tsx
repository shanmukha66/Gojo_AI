import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import PortalShell from "@/components/PortalShell";
import { doctorNav } from "@/lib/portalNav";
import { getDoctorPatientBundle } from "@/lib/doctorPatientBundle";
import DoctorPatientPageFrame from "@/components/doctor/DoctorPatientPageFrame";
import DoctorPatientReviewsPanel from "@/components/doctor/DoctorPatientReviewsPanel";
import { listVisitsForDoctorPatient } from "@/lib/scheduling";

function formatDate(value?: string | null) {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export default async function DoctorPatientReviewsPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "DOCTOR") redirect("/patient");
  const preferences = getUserPreferences(user.id);
  const { id } = await params;
  const bundle = await getDoctorPatientBundle(user.id, id);
  if (!bundle) redirect("/doctor/patients");
  const visits = listVisitsForDoctorPatient(user.id, id);

  return (
    <PortalShell
      badge="Patient Reviews"
      eyebrow="Formal Review Workflow"
      title="Formal patient reviews"
      description="Capture consultation-grade summary, assessment, plan, and follow-up in a dedicated review page."
      navItems={doctorNav}
      initialTheme={preferences.theme}
      headerActions={<a className="btn-secondary btn-fit" href="/doctor/patients">Back to patients</a>}
    >
      <DoctorPatientPageFrame patient={bundle.patient} activeTab="reviews">
        <DoctorPatientReviewsPanel
          patientId={bundle.patient.id}
          initialReviews={bundle.reviews}
          appointmentOptions={bundle.appointments.map((appointment) => ({
            id: appointment.id,
            label: `${formatDate(appointment.slotStart)} · ${appointment.status}`,
          }))}
          visitOptions={visits.map((visit) => ({
            id: visit.id,
            label: `${formatDate(visit.startedAt)} · ${visit.status}`,
          }))}
        />
      </DoctorPatientPageFrame>
    </PortalShell>
  );
}
