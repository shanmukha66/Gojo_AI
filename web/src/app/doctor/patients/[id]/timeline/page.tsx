import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import PortalShell from "@/components/PortalShell";
import { doctorNav } from "@/lib/portalNav";
import { getDoctorPatientBundle } from "@/lib/doctorPatientBundle";
import DoctorPatientPageFrame from "@/components/doctor/DoctorPatientPageFrame";

function formatDate(value?: string | null) {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function formatType(type: string) {
  switch (type) {
    case "review":
      return "Review";
    case "report":
      return "Report";
    case "lab":
      return "Lab";
    case "admission":
      return "Admission";
    case "discharge":
      return "Discharge";
    case "appointment":
      return "Appointment";
    default:
      return "Visit";
  }
}

export default async function DoctorPatientTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "DOCTOR") redirect("/patient");
  const preferences = getUserPreferences(user.id);
  const { id } = await params;
  const bundle = await getDoctorPatientBundle(user.id, id);
  if (!bundle) redirect("/doctor/patients");

  return (
    <PortalShell
      badge="Patient Timeline"
      eyebrow="Timeline Review"
      title="Timeline and graph paths"
      description="Work through visits, uploaded reports, findings, and formal reviews in one dedicated chart page."
      navItems={doctorNav}
      initialTheme={preferences.theme}
      headerActions={<a className="btn-secondary btn-fit" href="/doctor/patients">Back to patients</a>}
    >
      <DoctorPatientPageFrame patient={bundle.patient} activeTab="timeline">
        <section className="card-contrast stack-lg">
          <div className="panel-header">
            <div>
              <p className="section-title">Chart timeline</p>
              <p className="subtle text-sm mt-2">Date-ordered chart activity with clear source labels.</p>
            </div>
            <span className="pill">{bundle.timeline.events.length} events</span>
          </div>
          <div className="stack-md">
            {bundle.timeline.events.map((event, index) => (
              <article key={`${event.sourceLink || event.title}-${index}`} className="card card--dense stack-sm timeline-card">
                <div className="panel-header">
                  <div>
                    <p className="font-semibold">{event.title}</p>
                    <p className="subtle text-xs mt-1">{formatDate(event.at)} · {formatType(event.type)}</p>
                  </div>
                  <span className="pill">{event.sourceCategory}</span>
                </div>
                <p className="subtle text-sm leading-7">{event.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="card-contrast stack-lg">
          <div className="panel-header">
            <div>
              <p className="section-title">Knowledge graph paths</p>
              <p className="subtle text-sm mt-2">Richer graph relationships surfaced separately so they do not clutter the event stream.</p>
            </div>
            <span className="pill">{bundle.timeline.graphPaths.length} paths</span>
          </div>
          {bundle.timeline.graphPaths.length === 0 ? (
            <div className="empty-state">
              <p className="section-title">No graph paths yet</p>
              <p className="subtle text-sm">Graph paths will appear here as patient evidence expands.</p>
            </div>
          ) : (
            <div className="stack-md">
              {bundle.timeline.graphPaths.map((path, index) => (
                <article key={`${path.key}-${index}`} className="card card--dense stack-sm">
                  <div className="panel-header">
                    <div>
                      <p className="font-semibold">{path.title}</p>
                      <p className="subtle text-xs mt-1">{path.sourceCategory} · {formatDate(path.at)}</p>
                    </div>
                  </div>
                  <p className="subtle text-sm">{path.description}</p>
                  <p className="muted text-xs">{path.path.join(" -> ")}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </DoctorPatientPageFrame>
    </PortalShell>
  );
}
