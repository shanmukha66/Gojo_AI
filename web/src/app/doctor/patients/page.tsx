import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import PortalShell from "@/components/PortalShell";
import { doctorNav } from "@/lib/portalNav";
import DoctorPatientDirectory from "@/components/doctor/DoctorPatientDirectory";

export default async function DoctorPatientsPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "DOCTOR") redirect("/patient");
  const preferences = getUserPreferences(user.id);

  return (
    <PortalShell
      badge="Patient Charts"
      eyebrow="Patients"
      title="Open one patient chart at a time"
      description="Search from a compact patient directory, then move into overview, timeline, reports, copilot, memos, or reviews without mixing everything on one page."
      navItems={doctorNav}
      initialTheme={preferences.theme}
    >
      <DoctorPatientDirectory />
    </PortalShell>
  );
}
