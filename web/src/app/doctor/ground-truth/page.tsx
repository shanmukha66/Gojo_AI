import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import PortalShell from "@/components/PortalShell";
import { doctorNav } from "@/lib/portalNav";
import GroundTruthLibraryPanel from "./GroundTruthLibraryPanel";

export default async function DoctorGroundTruthPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "DOCTOR") redirect("/patient");
  const preferences = getUserPreferences(user.id);

  return (
    <PortalShell
      badge="Ground Truth"
      eyebrow="Trusted Knowledge"
      title="Manage medical ground truth"
      description="Store trusted clinical snippets, guideline notes, or textbook excerpts so AI answers are grounded in reusable evidence instead of generic text."
      navItems={doctorNav}
      initialTheme={preferences.theme}
    >
      <GroundTruthLibraryPanel />
    </PortalShell>
  );
}
