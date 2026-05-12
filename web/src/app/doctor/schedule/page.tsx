import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import DoctorScheduleBoard from "@/components/DoctorScheduleBoard";
import DoctorScheduleManager from "@/components/DoctorScheduleManager";
import { getUserPreferences } from "@/lib/preferences";
import { listDoctorAppointments, listDoctorAvailability } from "@/lib/scheduling";
import PortalShell from "@/components/PortalShell";
import { doctorNav } from "@/lib/portalNav";

export default async function DoctorSchedulePage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "DOCTOR") redirect("/patient");

  const preferences = getUserPreferences(user.id);
  const [availability, appointments] = await Promise.all([
    Promise.resolve(listDoctorAvailability(user.id)),
    listDoctorAppointments(user.id),
  ]);

  return (
    <PortalShell
      badge="Doctor Timetable"
      eyebrow="Schedule Center"
      title="See your work by day, week, month, and year"
      description="A dedicated schedule page keeps patient visits and availability out of the crowded workspace so you can track upcoming work cleanly."
      navItems={doctorNav}
      initialTheme={preferences.theme}
      headerActions={
        <a className="btn-secondary" href="/doctor/patients">
          Open Patients
        </a>
      }
    >
      <div className="schedule-compact">
        <DoctorScheduleBoard initialAvailability={availability} initialAppointments={appointments} />
      </div>
      <div className="schedule-manager-compact">
        <DoctorScheduleManager initialAvailability={availability} initialAppointments={appointments} />
      </div>
    </PortalShell>
  );
}
