import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import PortalShell from "@/components/PortalShell";
import { doctorNav } from "@/lib/portalNav";
import AiMetricsPanel from "./AiMetricsPanel";

export default async function AiMetricsPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "DOCTOR") redirect("/patient");
  const preferences = getUserPreferences(user.id);

  return (
    <PortalShell
      badge="MiniMax + RL"
      eyebrow="AI Operations"
      title="AI Usage and Learning Metrics"
      description="Track MiniMax usage, cache savings, fallback behavior, and early Q-learning reward signals."
      navItems={doctorNav}
      initialTheme={preferences.theme}
    >
      <AiMetricsPanel />
    </PortalShell>
  );
}
