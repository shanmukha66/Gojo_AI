import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";

export default function Home() {
  return (
    <div className="min-h-screen">
      <div className="grid-dots" />
      <div className="container-shell page-shell">
        <header className="app-header fade-up">
          <div className="app-header__cluster">
            <div className="h-14 w-14 rounded-[1.35rem] bg-[var(--accent)] text-[#071012] grid place-items-center font-semibold text-xl shadow-[0_16px_40px_-24px_rgba(70,198,177,0.8)]">
              G
            </div>
            <div>
              <p className="eyebrow">GOJO Health App</p>
              <p className="text-lg font-semibold mt-1">Explainable AI + RAG Clinical Support</p>
            </div>
          </div>
          <div className="app-header__cluster">
            <ThemeToggle />
            <Link className="btn-secondary" href="/login">
              Sign In
            </Link>
            <Link className="btn-primary" href="/register">
              Create Account
            </Link>
          </div>
        </header>

        <section className="hero fade-up" style={{ animationDelay: "120ms" }}>
          <div className="fade-up">
            <span className="badge">Human-led. AI‑assisted. Evidence‑grounded.</span>
            <h1 className="text-4xl md:text-6xl font-semibold leading-tight mt-4">
              Clinical clarity for doctors. Safe guidance for patients.
            </h1>
            <p className="subtle text-lg mt-5">
              A dual‑assistant system that surfaces risk signals, provides explainable secondary suggestions, and
              anchors every insight to patient evidence.
            </p>
            <div className="flex flex-wrap gap-3 mt-6">
              <Link className="btn-primary" href="/register?role=DOCTOR">
                I’m a Doctor
              </Link>
              <Link className="btn-secondary" href="/register?role=PATIENT">
                I’m a Patient
              </Link>
            </div>
          </div>
          <div className="glass fade-up" style={{ animationDelay: "160ms" }}>
            <div className="card-contrast">
              <div className="panel-header">
                <p className="section-title">What the system delivers</p>
                <span className="pill">Live now</span>
              </div>
              <div className="grid gap-4 mt-5">
                {[
                  "Risk score + confidence",
                  "Evidence cards from EHR timeline",
                  "AI opinion as secondary suggestion",
                  "Explicit final clinician decision",
                  "Separate patient‑safe assistant",
                ].map((item) => (
                  <div key={item} className="card">
                    <p className="font-semibold">{item}</p>
                    <p className="subtle text-sm mt-2">
                      Built for transparency and trust, with role‑based access and auditability.
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid md:grid-cols-2 gap-6 mt-2">
          <div className="card-contrast">
            <p className="section-title">Doctor Workspace</p>
            <p className="subtle mt-2">
              Search patients, review risks, and see evidence‑backed AI suggestions. Final decisions stay with the clinician.
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              <li>• Patient timeline graph + alerts</li>
              <li>• Evidence retrieval from structured EHR</li>
              <li>• Secondary AI opinion with confidence</li>
            </ul>
          </div>
          <div className="card-contrast">
            <p className="section-title">Patient Assistant</p>
            <p className="subtle mt-2">
              Friendly, safe first‑aid support and clear escalation guidance when urgent care is needed.
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              <li>• First‑aid knowledge base</li>
              <li>• Clear escalation guidance</li>
              <li>• No access to clinical records</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
