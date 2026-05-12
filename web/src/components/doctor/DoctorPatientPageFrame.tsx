import Link from "next/link";

const TABS = [
  { slug: "overview", label: "Overview" },
  { slug: "timeline", label: "Timeline" },
  { slug: "reports", label: "Reports" },
  { slug: "copilot", label: "Copilot" },
  { slug: "memos", label: "Memos" },
  { slug: "reviews", label: "Reviews" },
] as const;

type PatientHeader = {
  id: string;
  name?: string;
  age?: number;
  gender?: string;
  risk?: number;
  signals?: string[];
};

type Props = {
  patient: PatientHeader;
  activeTab: (typeof TABS)[number]["slug"];
  children: React.ReactNode;
  headerActions?: React.ReactNode;
};

function formatRisk(value?: number) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "Unavailable";
}

export default function DoctorPatientPageFrame({ patient, activeTab, children, headerActions }: Props) {
  return (
    <div className="stack-lg fade-up" style={{ animationDelay: "120ms" }}>
      <section className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Patient Chart</p>
            <p className="subtle text-sm mt-2">
              ID {patient.id} · Age {patient.age ?? "Unavailable"}{patient.gender ? ` · ${patient.gender}` : ""}
            </p>
            <h2 className="portal-page-title" style={{ fontSize: "1.35rem", marginTop: "0.45rem" }}>
              {patient.name || `Patient ${patient.id}`}
            </h2>
          </div>
          <div className="stack-sm items-end">
            <span className="pill">Risk {formatRisk(patient.risk)}</span>
            {headerActions}
          </div>
        </div>

        <div className="portal-subnav" role="tablist" aria-label="Patient pages">
          {TABS.map((tab) => {
            const href = `/doctor/patients/${encodeURIComponent(patient.id)}/${tab.slug}`;
            return (
              <Link
                key={tab.slug}
                href={href}
                className={`portal-subnav__item ${activeTab === tab.slug ? "portal-subnav__item--active" : ""}`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        {patient.signals && patient.signals.length > 0 ? (
          <div className="tag-row">
            {patient.signals.slice(0, 5).map((signal, index) => (
              <span key={`${patient.id}-signal-${index}`} className="tag-row__item">
                {signal}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {children}
    </div>
  );
}
