import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import PatientAssistant from "../PatientAssistant";
import { listPatientDocuments } from "@/lib/patientDocuments";
import { getOrCreatePatientRecordLink } from "@/lib/patientRecordLink";
import PortalShell from "@/components/PortalShell";
import { patientNav } from "@/lib/portalNav";

export default async function PatientAssistantPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "PATIENT") redirect("/doctor");
  const preferences = getUserPreferences(user.id);
  await getOrCreatePatientRecordLink(user.id);
  const initialDocuments = listPatientDocuments(user.id);

  return (
    <PortalShell
      badge="Patient Assistant"
      eyebrow="Questions and guidance"
      title="Ask calmly, read clearly, act safely"
      description="This page is focused only on the assistant, so report questions, first aid, and appointment intent feel cleaner and less crowded."
      navItems={patientNav}
      initialTheme={preferences.theme}
    >
      <PatientAssistant
        initialDocuments={initialDocuments.map((doc) => ({
          id: doc.id,
          fileName: doc.fileName,
          reportDate: doc.reportDate,
        }))}
      />
    </PortalShell>
  );
}
