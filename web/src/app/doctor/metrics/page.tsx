import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import MetricsDashboard from "./MetricsDashboard";
import PortalShell from "@/components/PortalShell";
import { doctorNav } from "@/lib/portalNav";

export default async function MetricsPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user) redirect("/login");
  if (user.role !== "DOCTOR") redirect("/patient");
  const preferences = getUserPreferences(user.id);

  return (
    <PortalShell
      badge="Prediction Review"
      eyebrow="Doctor Metrics"
      title="Model Comparison"
      description="Compare tabular, sequence, graph, and explainability outputs in a layout that is actually readable from normal working distance."
      navItems={doctorNav}
      initialTheme={preferences.theme}
      headerActions={
        <a className="btn-secondary" href="/doctor/workspace">
          Open Workspace
        </a>
      }
    >
      <div className="summary-grid">
              <div className="summary-tile">
                <p className="summary-tile__label">Comparison Goal</p>
                <p className="summary-tile__value">Readable</p>
                <p className="summary-tile__meta">Larger charts, stronger labels, and clearer model separation.</p>
              </div>
              <div className="summary-tile">
                <p className="summary-tile__label">Views</p>
                <p className="summary-tile__value">ROC · PR · SHAP</p>
                <p className="summary-tile__meta">Operational metrics plus explainability blocks.</p>
              </div>
              <div className="summary-tile">
                <p className="summary-tile__label">Task</p>
                <p className="summary-tile__value">Prediction QA</p>
                <p className="summary-tile__meta">Assess calibration, ranking, and subgroup behavior before using outputs.</p>
              </div>
      </div>

      <section className="hero fade-up" style={{ animationDelay: "120ms" }}>
          <div className="glass stack-md">
            <div className="panel-header">
              <div>
                <p className="section-title">Why this page matters</p>
                <p className="subtle text-sm mt-2">
                  Metrics should explain operational tradeoffs, not just decorate the screen. Each section below is meant to answer a different model quality question.
                </p>
              </div>
              <span className="pill">Compare · Explain · Inspect</span>
            </div>
            <div className="card-grid md:grid-cols-3">
              <div className="surface">
                <p className="eyebrow">Ranking</p>
                <p className="text-lg font-semibold mt-2">ROC and PR curves</p>
                <p className="subtle text-sm mt-2">Measure discrimination and performance under class imbalance.</p>
              </div>
              <div className="surface">
                <p className="eyebrow">Robustness</p>
                <p className="text-lg font-semibold mt-2">Subgroup slices</p>
                <p className="subtle text-sm mt-2">Check whether behavior shifts across different patient slices.</p>
              </div>
              <div className="surface">
                <p className="eyebrow">Explainability</p>
                <p className="text-lg font-semibold mt-2">Feature impact</p>
                <p className="subtle text-sm mt-2">SHAP bars and chart notes clarify what is driving predictions.</p>
              </div>
            </div>
          </div>

          <div className="card-contrast stack-md">
            <div>
              <p className="section-title">Reading guide</p>
              <p className="subtle text-sm mt-2">
                Use ROC for overall ranking quality, PR when positives are rare, subgroup metrics for equity checks, and SHAP to inspect what the tabular models react to most strongly.
              </p>
            </div>
            <div className="status-banner">
              <span className="badge">Step 1 UI Refresh</span>
              <span className="subtle text-sm">This view is being tuned for publication-quality readability and not just internal debugging.</span>
            </div>
          </div>
      </section>

      <div className="fade-up" style={{ animationDelay: "180ms" }}>
        <MetricsDashboard />
      </div>
    </PortalShell>
  );
}
