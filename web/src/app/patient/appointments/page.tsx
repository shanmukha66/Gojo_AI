import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import PatientAppointments from "@/components/PatientAppointments";
import { getOrCreatePatientRecordLink } from "@/lib/patientRecordLink";
import { listBookableSlots, listDoctors, listPatientAppointments } from "@/lib/scheduling";
import PortalShell from "@/components/PortalShell";
import { patientNav } from "@/lib/portalNav";

export default async function PatientAppointmentsPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "PATIENT") redirect("/doctor");
  const preferences = getUserPreferences(user.id);
  await getOrCreatePatientRecordLink(user.id);

  const [initialAppointments, initialDoctors, initialSlots] = await Promise.all([
    listPatientAppointments(user.id),
    Promise.resolve(listDoctors()),
    Promise.resolve(listBookableSlots()),
  ]);

  return (
    <PortalShell
      badge="Appointments"
      eyebrow="Patient scheduling"
      title="Appointments"
      description="Request visits, review upcoming bookings, and follow appointment status from one place."
      navItems={patientNav}
      initialTheme={preferences.theme}
    >
      <PatientAppointments
        initialDoctors={initialDoctors}
        initialSlots={initialSlots}
        initialAppointments={initialAppointments}
      />
    </PortalShell>
  );
}
