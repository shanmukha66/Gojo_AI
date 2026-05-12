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

function formatRisk(value?: number) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "Unavailable";
}

export default async function DoctorPatientOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "DOCTOR") redirect("/patient");
  const preferences = getUserPreferences(user.id);
  const { id } = await params;
  const bundle = await getDoctorPatientBundle(user.id, id);
  if (!bundle) redirect("/doctor/patients");

  const nextAppointment = bundle.appointments.find((item) => ["requested", "booked", "confirmed", "revisit_suggested"].includes(item.status));
  const latestReview = bundle.reviews[0];
  const latestReport = bundle.reports[0];

  return (
    <PortalShell
      badge="Patient Overview"
      eyebrow="Patient Context"
      title="Patient overview"
      description="Open the patient chart in a calmer layout with one clear task area per page."
      navItems={doctorNav}
      initialTheme={preferences.theme}
      headerActions={<a className="btn-secondary btn-fit" href="/doctor/patients">Back to patients</a>}
    >
      <DoctorPatientPageFrame patient={bundle.patient} activeTab="overview">
        <div className="card-grid card-grid--tight md:grid-cols-3">
          <section className="card-contrast stack-sm">
            <p className="eyebrow">Current risk</p>
            <p className="text-3xl font-semibold">{formatRisk(bundle.patient.risk)}</p>
            <p className="subtle text-sm">Latest risk snapshot from the active graph/prediction context.</p>
          </section>
          <section className="card-contrast stack-sm">
            <p className="eyebrow">Next appointment</p>
            <p className="text-xl font-semibold">{nextAppointment ? formatDate(nextAppointment.slotStart) : "No upcoming visit"}</p>
            <p className="subtle text-sm">{nextAppointment ? nextAppointment.status : "No requested or booked follow-up at the moment."}</p>
          </section>
          <section className="card-contrast stack-sm">
            <p className="eyebrow">Latest review</p>
            <p className="text-xl font-semibold">{latestReview?.title || "No review yet"}</p>
            <p className="subtle text-sm">{latestReview ? `Updated ${formatDate(latestReview.updatedAt)}` : "Formal clinical reviews will appear here."}</p>
          </section>
        </div>

        <section className="card-contrast stack-lg">
          <div className="panel-header">
            <div>
              <p className="section-title">Clinical chart summary</p>
              <p className="subtle text-sm mt-2">A chart-style overview of demographics, risk, evidence, notes, and upcoming work.</p>
            </div>
            <span className="pill">Focused pages</span>
          </div>
          <div className="card-grid md:grid-cols-3">
            <article className="surface stack-sm">
              <p className="eyebrow">Demographics</p>
              <p className="font-semibold text-lg">{bundle.patient.name || `Patient ${bundle.patient.id}`}</p>
              <p className="subtle text-sm">Age {bundle.patient.age ?? "Unavailable"}{bundle.patient.gender ? ` · ${bundle.patient.gender}` : ""}</p>
              <p className="subtle text-sm">Record ID {bundle.patient.id}</p>
            </article>
            <article className="surface stack-sm">
              <p className="eyebrow">Evidence status</p>
              <p className="font-semibold text-lg">{bundle.reports.length} report(s) · {bundle.timeline.events.length} event(s)</p>
              <p className="subtle text-sm">Latest report: {latestReport?.fileName || "No uploaded report"}</p>
            </article>
            <article className="surface stack-sm">
              <p className="eyebrow">Care activity</p>
              <p className="font-semibold text-lg">{bundle.memos.length} memo(s) · {bundle.reviews.length} review(s)</p>
              <p className="subtle text-sm">Next appointment: {nextAppointment ? formatDate(nextAppointment.slotStart) : "None scheduled"}</p>
            </article>
            <a className="surface stack-sm" href={`/doctor/patients/${bundle.patient.id}/timeline`}>
              <p className="eyebrow">Timeline</p>
              <p className="font-semibold text-lg">{bundle.timeline.events.length} chart events</p>
              <p className="subtle text-sm">Visits, reports, reviews, and graph evidence in date order.</p>
            </a>
            <a className="surface stack-sm" href={`/doctor/patients/${bundle.patient.id}/reports`}>
              <p className="eyebrow">Reports</p>
              <p className="font-semibold text-lg">{bundle.reports.length} uploaded report(s)</p>
              <p className="subtle text-sm">Structured findings, extracted text, and abnormal flags.</p>
            </a>
            <a className="surface stack-sm" href={`/doctor/patients/${bundle.patient.id}/copilot`}>
              <p className="eyebrow">Copilot</p>
              <p className="font-semibold text-lg">Grounded doctor Q&A</p>
              <p className="subtle text-sm">Ask focused questions or generate a decision-support report.</p>
            </a>
            <a className="surface stack-sm" href={`/doctor/patients/${bundle.patient.id}/reviews`}>
              <p className="eyebrow">Reviews</p>
              <p className="font-semibold text-lg">Formal consultation notes</p>
              <p className="subtle text-sm">Assessment, plan, follow-up, and revisit recommendation.</p>
            </a>
          </div>
        </section>

        <section className="card-contrast stack-lg">
          <div className="panel-header">
            <div>
              <p className="section-title">Recent highlights</p>
              <p className="subtle text-sm mt-2">A compact summary before you jump into the detailed pages.</p>
            </div>
          </div>
          <div className="card-grid md:grid-cols-2">
            <article className="surface stack-sm">
              <p className="eyebrow">Most recent timeline event</p>
              <p className="font-semibold text-lg">{bundle.timeline.events[0]?.title || "No timeline event"}</p>
              <p className="subtle text-sm">{bundle.timeline.events[0]?.description || "No chart activity has been loaded for this patient yet."}</p>
            </article>
            <article className="surface stack-sm">
              <p className="eyebrow">Latest report</p>
              <p className="font-semibold text-lg">{latestReport?.fileName || "No uploaded report"}</p>
              <p className="subtle text-sm">{latestReport ? `Report date ${formatDate(latestReport.reportDate)}` : "Uploaded documents will appear here once linked to the patient."}</p>
            </article>
          </div>
        </section>
      </DoctorPatientPageFrame>
    </PortalShell>
  );
}
