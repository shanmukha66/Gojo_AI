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
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export default async function DoctorPatientReportsPage({ params }: { params: Promise<{ id: string }> }) {
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
      badge="Patient Reports"
      eyebrow="Report Review"
      title="Uploaded reports and extracted findings"
      description="Keep report review on its own page so extracted findings, abnormal values, and text excerpts stay readable."
      navItems={doctorNav}
      initialTheme={preferences.theme}
      headerActions={<a className="btn-secondary btn-fit" href="/doctor/patients">Back to patients</a>}
    >
      <DoctorPatientPageFrame patient={bundle.patient} activeTab="reports">
        {bundle.reports.length === 0 ? (
          <section className="card-contrast empty-state">
            <p className="section-title">No uploaded reports</p>
            <p className="subtle text-sm">This patient does not have linked uploaded reports yet.</p>
          </section>
        ) : (
          <div className="stack-lg">
            {bundle.reports.map((report) => (
              <section key={report.id} className="card-contrast stack-lg">
                <div className="panel-header">
                  <div>
                    <p className="section-title">{report.fileName}</p>
                    <p className="subtle text-sm mt-2">{report.status} · Report date {formatDate(report.reportDate)}</p>
                  </div>
                  <span className="pill">{report.sourceCategory}</span>
                </div>
                <div className="card-grid md:grid-cols-2">
                  <article className="surface stack-sm">
                    <p className="eyebrow">Structured findings</p>
                    {report.observations.length === 0 ? (
                      <p className="subtle text-sm">No structured findings extracted yet.</p>
                    ) : (
                      <div className="list text-sm">
                        {report.observations.slice(0, 8).map((obs) => (
                          <div key={obs.id}>
                            • {obs.testName}
                            {obs.valueText ? ` · ${obs.valueText}${obs.unit ? ` ${obs.unit}` : ""}` : ""}
                            {obs.referenceRange ? ` · ref ${obs.referenceRange}` : ""}
                            {obs.abnormalFlag ? ` · ${obs.abnormalFlag}` : ""}
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                  <article className="surface stack-sm">
                    <p className="eyebrow">Timeline impact</p>
                    <div className="list text-sm">
                      {report.timelineImpact.map((item, index) => <div key={`${report.id}-impact-${index}`}>• {item}</div>)}
                    </div>
                  </article>
                </div>
                <article className="surface stack-sm">
                  <p className="eyebrow">Extracted report text</p>
                  <p className="subtle text-sm leading-7">{report.extractedText ? `${report.extractedText.slice(0, 900)}${report.extractedText.length > 900 ? "..." : ""}` : report.extractionError || "Unavailable"}</p>
                </article>
              </section>
            ))}
          </div>
        )}
      </DoctorPatientPageFrame>
    </PortalShell>
  );
}
