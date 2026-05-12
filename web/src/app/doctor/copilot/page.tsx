import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import PortalShell from "@/components/PortalShell";
import { doctorNav } from "@/lib/portalNav";
import DoctorGeneralCopilot from "./DoctorGeneralCopilot";

export default async function DoctorCopilotPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "DOCTOR") redirect("/patient");
  const preferences = getUserPreferences(user.id);

  return (
    <PortalShell
      badge="Doctor Copilot"
      eyebrow="Second Opinion"
      title="Ask general clinical doubts"
      description="A ChatGPT-like doctor workspace using MiniMax, local ground-truth snippets, cache, and RL metrics. Patient-specific copilot remains inside each patient chart."
      navItems={doctorNav}
      initialTheme={preferences.theme}
    >
      <DoctorGeneralCopilot />
    </PortalShell>
  );
}
