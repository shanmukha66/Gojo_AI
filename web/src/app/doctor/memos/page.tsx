import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import DoctorMemosBoard from "@/components/DoctorMemosBoard";
import { getUserPreferences } from "@/lib/preferences";
import PortalShell from "@/components/PortalShell";
import { doctorNav } from "@/lib/portalNav";

export default async function DoctorMemosPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "DOCTOR") redirect("/patient");
  const preferences = getUserPreferences(user.id);

  return (
    <PortalShell
      badge="Doctor Memos"
      eyebrow="Private Workspace"
      title="Keep planning notes separate from patient review"
      description="Personal memos live on their own page so the main workspace stays focused on patient evidence, reports, and actions."
      navItems={doctorNav}
      initialTheme={preferences.theme}
      headerActions={
        <a className="btn-secondary" href="/doctor/workspace">
          Open Workspace
        </a>
      }
    >
      <DoctorMemosBoard />
    </PortalShell>
  );
}
