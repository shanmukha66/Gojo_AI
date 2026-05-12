import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import PatientDocuments from "@/components/PatientDocuments";
import { getPatientDocument, listPatientDocuments } from "@/lib/patientDocuments";
import { getOrCreatePatientRecordLink } from "@/lib/patientRecordLink";
import PortalShell from "@/components/PortalShell";
import { patientNav } from "@/lib/portalNav";

export default async function PatientReportsPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "PATIENT") redirect("/doctor");
  const preferences = getUserPreferences(user.id);
  await getOrCreatePatientRecordLink(user.id);
  const initialDocuments = listPatientDocuments(user.id);
  const initialSelectedDocument = initialDocuments[0] ? getPatientDocument(initialDocuments[0].id, user.id) : null;

  return (
    <PortalShell
      badge="Patient Reports"
      eyebrow="Clinical documents"
      title="Upload, inspect, and understand your reports"
      description="Your uploads and extracted report details now live on their own page so document work is separated from chat and booking."
      navItems={patientNav}
      initialTheme={preferences.theme}
    >
      <PatientDocuments
        initialDocuments={initialDocuments}
        initialSelectedDocument={initialSelectedDocument}
      />
    </PortalShell>
  );
}
