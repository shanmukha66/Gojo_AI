"use client";

import { useEffect, useMemo, useState } from "react";

type ModelMetrics = {
  model: string;
  dataset?: string;
  roc_auc?: number;
  pr_auc?: number;
  f1?: number;
  brier?: number;
  train_size?: number;
  test_size?: number;
};

type MetricsPayload = {
  generated_at: string;
  models: ModelMetrics[];
};

type CurvePoint = { fpr?: number; tpr?: number; recall?: number; precision?: number };

type CurveModel = {
  model: string;
  dataset?: string;
  roc?: CurvePoint[];
  pr?: CurvePoint[];
};

type CurvesPayload = {
  generated_at: string;
  models: CurveModel[];
};

type SubgroupEntry = {
  group: string;
  support: number;
  roc_auc?: number;
  pr_auc?: number;
  f1?: number;
  brier?: number;
};

type SubgroupModel = {
  model: string;
  dataset?: string;
  groups: SubgroupEntry[];
};

type SubgroupsPayload = {
  generated_at: string;
  models: SubgroupModel[];
};

type ShapFeature = { name: string; importance: number };

type ShapModel = {
  model: string;
  dataset?: string;
  features: ShapFeature[];
};

type ShapPayload = {
  generated_at: string;
  models: ShapModel[];
};

type NumericMetricKey = "roc_auc" | "pr_auc" | "f1" | "brier";

const metricLabels: { key: NumericMetricKey; label: string; description: string }[] = [
  {
    key: "roc_auc",
    label: "ROC-AUC",
    description: "How well the model separates positive and negative cases across thresholds.",
  },
  {
    key: "pr_auc",
    label: "PR-AUC",
    description: "Precision-recall quality, especially important when positive cases are relatively rare.",
  },
  {
    key: "f1",
    label: "F1 Score",
    description: "Single balance point between precision and recall at the chosen classification threshold.",
  },
  {
    key: "brier",
    label: "Brier Score",
    description: "Probability error. Lower is better because predicted risk should match observed outcomes.",
  },
];

const darkPalette = ["#46c6b1", "#75a7ff", "#ffbf67", "#f47f93", "#8c7cff", "#5dd17a", "#ff8f54"];
const lightPalette = ["#0a8f8d", "#356ed8", "#d88b20", "#cf4d71", "#7159e3", "#228a53", "#df6c1a"];

function getPalette(theme: "light" | "dark") {
  return theme === "light" ? lightPalette : darkPalette;
}

function getColor(index: number, theme: "light" | "dark") {
  const palette = getPalette(theme);
  return palette[index % palette.length];
}

function modelDescription(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("graph")) return "Graph-aware model using relational structure between encounters and conditions.";
  if (lower.includes("sequence") || lower.includes("lstm")) return "Sequence-oriented model that emphasizes order across visits or events.";
  if (lower.includes("xgboost") || lower.includes("boost")) return "Gradient-boosted model optimized for strong tabular prediction performance.";
  if (lower.includes("logistic")) return "Baseline linear classifier used for interpretability and comparison.";
  if (lower.includes("gnn") || lower.includes("gcn")) return "True graph neural network that learns from node connectivity and neighborhood signal.";
  return "Comparison model included in the current predictive evaluation pipeline.";
}

function formatFeatureName(name: string) {
  const raw = name.replace(/^num__/, "").replace(/^cat__/, "");
  const categoricalGender = raw.match(/^gender_(.+)$/i);
  if (categoricalGender) {
    const value = categoricalGender[1];
    if (value === "1") return "Gender category 1";
    if (value === "2") return "Gender category 2";
    return `Gender: ${value}`;
  }

  const replacements: Record<string, string> = {
    age: "Age",
    risk: "Risk score",
    visit_count: "Visit count",
    inpatient_visits: "Inpatient visits",
    outpatient_visits: "Outpatient visits",
    condition_count: "Condition count",
    chronic_condition_count: "Chronic condition count",
    condition_popularity_mean: "Average condition prevalence",
    condition_popularity_sum: "Total condition prevalence",
    min_days_between_visits: "Minimum days between visits",
    avg_days_between_visits: "Average days between visits",
    recent_visit_gap_days: "Days since recent visit",
  };

  return replacements[raw] || raw.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function whatModelPredicts(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("claims")) return "It estimates risk from claims-style longitudinal utilization and condition history.";
  if (lower.includes("gnn") || lower.includes("gcn")) return "It predicts risk by learning from graph neighborhoods such as linked visits, conditions, and utilization patterns.";
  if (lower.includes("sequence") || lower.includes("lstm")) return "It predicts risk from event order, so recent visit sequences matter more than isolated counts.";
  if (lower.includes("graph")) return "It predicts risk from both patient-level features and relational structure between medical events.";
  return "It predicts downstream clinical risk from the currently engineered patient feature set.";
}

function whyScoreMatters(model: ModelMetrics) {
  const roc = model.roc_auc ?? 0;
  const pr = model.pr_auc ?? 0;
  if (roc >= 0.85 && pr >= 0.55) return "This model is strong enough to be a serious candidate for secondary clinical review support.";
  if (roc >= 0.75) return "This model separates higher-risk and lower-risk patients reasonably well, but still needs calibration and clinician oversight.";
  return "This model is useful as a benchmark or supporting signal, but not yet strong enough to stand alone.";
}

function formatMetric(value?: number) {
  if (typeof value !== "number") return "n/a";
  return value.toFixed(3);
}

function formatDelta(value: number) {
  if (value === 0) return "0.000";
  return `${value > 0 ? "+" : ""}${value.toFixed(3)}`;
}

function CurveChart({
  points,
  xKey,
  yKey,
  xLabel,
  yLabel,
  color,
  showDiagonal = false,
}: {
  points: CurvePoint[];
  xKey: keyof CurvePoint;
  yKey: keyof CurvePoint;
  xLabel: string;
  yLabel: string;
  color: string;
  showDiagonal?: boolean;
}) {
  if (!points || points.length === 0) {
    return <div className="empty-state"><p className="section-title">No curve data</p><p className="subtle text-sm">This model does not currently expose this curve payload.</p></div>;
  }

  const normalized = points.map((point) => ({
    x: Math.max(0, Math.min(1, Number(point[xKey] ?? 0))),
    y: Math.max(0, Math.min(1, Number(point[yKey] ?? 0))),
  }));

  const path = normalized
    .map((point, index) => `${index === 0 ? "M" : "L"} ${60 + point.x * 500} ${340 - point.y * 260}`)
    .join(" ");

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox="0 0 620 390" className="w-full h-[20rem]">
      <defs>
        <linearGradient id={`fill-${color.replace("#", "")}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.06" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="620" height="390" rx="28" fill="transparent" />
      {ticks.map((tick) => {
        const x = 60 + tick * 500;
        const y = 340 - tick * 260;
        return (
          <g key={`tick-${tick}`}>
            <line x1={x} y1={80} x2={x} y2={340} stroke="var(--stroke-strong)" strokeDasharray="4 10" />
            <line x1={60} y1={y} x2={560} y2={y} stroke="var(--stroke-strong)" strokeDasharray="4 10" />
            <text x={x} y={362} textAnchor="middle" fontSize="13" fill="var(--ink-muted)">
              {tick.toFixed(2)}
            </text>
            <text x={42} y={y + 5} textAnchor="end" fontSize="13" fill="var(--ink-muted)">
              {tick.toFixed(2)}
            </text>
          </g>
        );
      })}
      {showDiagonal ? (
        <path
          d="M 60 340 L 560 80"
          stroke="var(--ink-faint)"
          strokeWidth="2"
          fill="none"
          strokeDasharray="8 8"
          opacity="0.45"
        />
      ) : null}
      <path d="M60 80 L60 340 L560 340" stroke="var(--ink)" strokeWidth="2.2" fill="none" opacity="0.55" />
      <path d={`${path} L 560 340 L 60 340 Z`} fill={`url(#fill-${color.replace("#", "")})`} opacity="0.9" />
      <path d={path} stroke={color} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {normalized.map((point, index) => {
        const cx = 60 + point.x * 500;
        const cy = 340 - point.y * 260;
        return (
          <circle key={`pt-${index}`} cx={cx} cy={cy} r="5" fill={color} stroke="white" strokeWidth="1.4">
            <title>{`${xLabel}: ${point.x.toFixed(3)} | ${yLabel}: ${point.y.toFixed(3)}`}</title>
          </circle>
        );
      })}
      <text x="310" y="385" textAnchor="middle" fontSize="15" fill="var(--ink-muted)">
        {xLabel}
      </text>
      <text
        x="16"
        y="210"
        textAnchor="middle"
        fontSize="15"
        fill="var(--ink-muted)"
        transform="rotate(-90 16 210)"
      >
        {yLabel}
      </text>
    </svg>
  );
}

export default function MetricsDashboard() {
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [curves, setCurves] = useState<CurvesPayload | null>(null);
  const [subgroups, setSubgroups] = useState<SubgroupsPayload | null>(null);
  const [shap, setShap] = useState<ShapPayload | null>(null);
  const [error, setError] = useState<string>("");
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    Promise.all([
      fetch("/predictive/metrics.json", { cache: "no-store" }),
      fetch("/predictive/curves.json", { cache: "no-store" }),
      fetch("/predictive/subgroups.json", { cache: "no-store" }),
      fetch("/predictive/shap.json", { cache: "no-store" }),
    ])
      .then(async ([metricsRes, curvesRes, subgroupRes, shapRes]) => {
        if (!metricsRes.ok) throw new Error("Unable to load metrics");
        setMetrics((await metricsRes.json()) as MetricsPayload);
        if (curvesRes.ok) setCurves((await curvesRes.json()) as CurvesPayload);
        if (subgroupRes.ok) setSubgroups((await subgroupRes.json()) as SubgroupsPayload);
        if (shapRes.ok) setShap((await shapRes.json()) as ShapPayload);
      })
      .catch((err) => setError(err.message || "Unable to load metrics"));
  }, []);

  useEffect(() => {
    const applyTheme = () => {
      const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
      setTheme(current);
    };

    applyTheme();

    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const topModel = useMemo(() => {
    if (!metrics?.models?.length) return undefined;
    return [...metrics.models].sort((a, b) => (b.roc_auc ?? -1) - (a.roc_auc ?? -1))[0];
  }, [metrics]);

  const bestPrModel = useMemo(() => {
    if (!metrics?.models?.length) return undefined;
    return [...metrics.models].sort((a, b) => (b.pr_auc ?? -1) - (a.pr_auc ?? -1))[0];
  }, [metrics]);

  const bestCalibratedModel = useMemo(() => {
    if (!metrics?.models?.length) return undefined;
    return [...metrics.models].sort((a, b) => (a.brier ?? Number.POSITIVE_INFINITY) - (b.brier ?? Number.POSITIVE_INFINITY))[0];
  }, [metrics]);

  const orderedModels = useMemo(() => {
    if (!metrics?.models?.length) return [];
    return [...metrics.models].sort((a, b) => (b.roc_auc ?? -1) - (a.roc_auc ?? -1));
  }, [metrics]);

  const medianRoc = useMemo(() => {
    if (!orderedModels.length) return undefined;
    const rocs = orderedModels.map((model) => model.roc_auc ?? 0);
    const middle = Math.floor(rocs.length / 2);
    return rocs.length % 2 === 0 ? (rocs[middle - 1] + rocs[middle]) / 2 : rocs[middle];
  }, [orderedModels]);

  const strongestModels = useMemo(() => orderedModels.slice(0, 3), [orderedModels]);
  const watchlistModels = useMemo(() => orderedModels.slice(-2).reverse(), [orderedModels]);

  const shapMap = useMemo(() => {
    const map = new Map<string, ShapModel>();
    shap?.models?.forEach((model) => map.set(`${model.model}:${model.dataset || "synthea"}`, model));
    return map;
  }, [shap]);

  const subgroupMap = useMemo(() => {
    const map = new Map<string, SubgroupModel>();
    subgroups?.models?.forEach((model) => map.set(`${model.model}:${model.dataset || "synthea"}`, model));
    return map;
  }, [subgroups]);

  if (error) {
    return (
      <div className="status-banner status-banner--error">
        <strong>Unable to load metrics</strong>
        <span>{error}</span>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="empty-state">
        <p className="section-title">Loading prediction metrics</p>
        <p className="subtle text-sm">Pulling comparison artifacts from the generated predictive output bundle.</p>
      </div>
    );
  }

  return (
    <div className="dashboard-grid">
      <section className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Summary Area</p>
            <p className="subtle text-sm mt-2">A quick orientation to the current artifact set before you inspect each model section.</p>
          </div>
          <span className="pill">Generated {new Date(metrics.generated_at).toLocaleString()}</span>
        </div>
        <div className="summary-grid">
          <div className="summary-tile">
            <p className="summary-tile__label">Models Compared</p>
            <p className="summary-tile__value">{metrics.models.length}</p>
            <p className="summary-tile__meta">All models currently available in the artifact bundle.</p>
          </div>
          <div className="summary-tile">
            <p className="summary-tile__label">Best ROC-AUC</p>
            <p className="summary-tile__value">{topModel?.roc_auc?.toFixed(3) ?? "n/a"}</p>
            <p className="summary-tile__meta">{topModel ? `${topModel.model} (${topModel.dataset || "synthea"})` : "No model data loaded"}</p>
          </div>
          <div className="summary-tile">
            <p className="summary-tile__label">Best PR-AUC</p>
            <p className="summary-tile__value">{bestPrModel?.pr_auc?.toFixed(3) ?? "n/a"}</p>
            <p className="summary-tile__meta">{bestPrModel ? `${bestPrModel.model} is best on positive-case retrieval.` : "No precision-recall data loaded"}</p>
          </div>
          <div className="summary-tile">
            <p className="summary-tile__label">Explainability</p>
            <p className="summary-tile__value">{shap?.models?.length ?? 0}</p>
            <p className="summary-tile__meta">Models with SHAP feature attribution currently available.</p>
          </div>
          <div className="summary-tile">
            <p className="summary-tile__label">Best Calibration</p>
            <p className="summary-tile__value">{bestCalibratedModel?.brier?.toFixed(3) ?? "n/a"}</p>
            <p className="summary-tile__meta">{bestCalibratedModel ? `${bestCalibratedModel.model} has the lowest Brier score.` : "No calibration data loaded"}</p>
          </div>
        </div>
      </section>

      <section className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Latest Prediction Run</p>
            <p className="subtle text-sm mt-2">
              This translates the current artifact bundle into a plain-language readout for the doctor-facing research dashboard.
            </p>
          </div>
          <span className="pill">Run Summary</span>
        </div>
        <div className="card-grid md:grid-cols-3">
          <article className="surface stack-sm">
            <p className="eyebrow">What Changed</p>
            <p className="text-lg font-semibold">Current run snapshot loaded</p>
            <p className="subtle text-sm">
              Historical run-to-run deltas are not yet stored in this artifact bundle, so this summary compares models within the current run rather than claiming a true trend.
            </p>
          </article>
          <article className="surface stack-sm">
            <p className="eyebrow">Strongest Right Now</p>
            <div className="list text-sm">
              {strongestModels.map((model, index) => (
                <div key={`${model.model}-strong`}>
                  • {index + 1}. {model.model}: ROC {formatMetric(model.roc_auc)} | PR {formatMetric(model.pr_auc)}
                </div>
              ))}
            </div>
          </article>
          <article className="surface stack-sm">
            <p className="eyebrow">Needs Attention</p>
            <div className="list text-sm">
              {watchlistModels.map((model) => {
                const delta = (model.roc_auc ?? 0) - (medianRoc ?? 0);
                return (
                  <div key={`${model.model}-watch`}>
                    • {model.model}: ROC vs median {formatDelta(delta)} | Brier {formatMetric(model.brier)}
                  </div>
                );
              })}
            </div>
          </article>
        </div>
      </section>

      <section className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Model Legend</p>
            <p className="subtle text-sm mt-2">Each model keeps the same color across metric bars, ROC/PR charts, and explainability cards.</p>
          </div>
          <span className="pill">Visual Index</span>
        </div>
        <div className="card-grid md:grid-cols-2">
          {orderedModels.map((model, index) => {
            const color = getColor(index, theme);
            return (
              <article key={`${model.model}-legend`} className="surface stack-sm">
                <div className="panel-header">
                  <div className="app-header__cluster">
                    <span
                      aria-hidden="true"
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 999,
                        background: color,
                        boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 16%, transparent)`,
                      }}
                    />
                    <div>
                      <p className="font-semibold">{model.model}</p>
                      <p className="subtle text-xs mt-1">{model.dataset || "synthea"}</p>
                    </div>
                  </div>
                  <span className="badge" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
                    ROC {formatMetric(model.roc_auc)}
                  </span>
                </div>
                <p className="subtle text-sm">{modelDescription(model.model)}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Metric Comparison</p>
            <p className="subtle text-sm mt-2">
              Large metric bars make it easier to compare model quality without squinting at tiny values.
            </p>
          </div>
          <span className="pill">Performance Overview</span>
        </div>
        <div className="card-grid md:grid-cols-2">
          {metricLabels.map((metric) => (
            <article key={metric.key as string} className="chart-shell stack-md">
              <div>
                <p className="text-xl font-semibold">{metric.label}</p>
                <p className="subtle text-sm mt-2">{metric.description}</p>
              </div>
              <div className="stack-md">
                {metrics.models.map((model, index) => {
                  const value = model[metric.key];
                  const normalized = typeof value === "number" ? Math.max(0, Math.min(1, metric.key === "brier" ? 1 - value : value)) : 0;
                  const color = getColor(index, theme);
                  return (
                    <div key={`${model.model}-${metric.key}`} className="stack-sm">
                      <div className="panel-header">
                        <div>
                          <p className="font-semibold">{model.model}</p>
                          <p className="subtle text-xs mt-1">{model.dataset || "synthea"}</p>
                        </div>
                        <strong>{formatMetric(value)}</strong>
                      </div>
                      <div className="metric-bar">
                        <span style={{ width: `${normalized * 100}%`, background: color }} />
                      </div>
                      <p className="muted text-xs">{modelDescription(model.model)}</p>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Data Split and Model Notes</p>
            <p className="subtle text-sm mt-2">This section clarifies training/test sizes and what each model family contributes.</p>
          </div>
          <span className="pill">Context</span>
        </div>
        <div className="card-grid md:grid-cols-2">
          {metrics.models.map((model, index) => (
            <article key={`${model.model}-context`} className="card stack-md">
              <div className="panel-header">
                <div>
                  <p className="text-lg font-semibold">{model.model}</p>
                  <p className="subtle text-sm mt-1">{model.dataset || "synthea"}</p>
                </div>
                <span className="badge" style={{ background: "color-mix(in srgb, var(--accent-3) 16%, transparent)", color: getColor(index, theme) }}>
                  {model.roc_auc?.toFixed(3) ?? "n/a"}
                </span>
              </div>
              <div className="stack-sm">
                <p className="subtle text-sm"><strong>What this model is:</strong> {modelDescription(model.model)}</p>
                <p className="subtle text-sm"><strong>What it predicts:</strong> {whatModelPredicts(model.model)}</p>
                <p className="subtle text-sm"><strong>Why the score matters:</strong> {whyScoreMatters(model)}</p>
              </div>
              <div className="list">
                <div>• Train size: {model.train_size ?? "n/a"}</div>
                <div>• Test size: {model.test_size ?? "n/a"}</div>
                <div>• PR-AUC: {model.pr_auc?.toFixed(3) ?? "n/a"}</div>
                <div>• F1: {model.f1?.toFixed(3) ?? "n/a"}</div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">ROC and PR Curves</p>
            <p className="subtle text-sm mt-2">
              Curves are enlarged with clearer axes and hover values so they can be used for normal visual comparison and publication screenshots.
            </p>
          </div>
          <span className="pill">Readable Charts</span>
        </div>
        <div className="card-grid">
          {curves?.models?.map((model, index) => {
            const color = getColor(index, theme);
            return (
              <article key={`${model.model}-curves`} className="chart-shell stack-lg">
                <div className="panel-header">
                  <div>
                    <p className="text-2xl font-semibold">{model.model}</p>
                    <p className="subtle text-sm mt-1">{model.dataset || "synthea"}</p>
                  </div>
                  <span className="badge" style={{ background: "color-mix(in srgb, var(--accent-3) 16%, transparent)", color }}>
                    {modelDescription(model.model).split(".")[0]}
                  </span>
                </div>
                <p className="muted text-sm">
                  ROC emphasizes ranking quality across thresholds. PR is especially important when the positive class is relatively sparse.
                </p>
                <div className="card-grid md:grid-cols-2">
                  <div className="surface stack-sm">
                    <p className="eyebrow">ROC Curve</p>
                    <CurveChart
                      points={model.roc || []}
                      xKey="fpr"
                      yKey="tpr"
                      xLabel="False Positive Rate"
                      yLabel="True Positive Rate"
                      color={color}
                      showDiagonal
                    />
                  </div>
                  <div className="surface stack-sm">
                    <p className="eyebrow">PR Curve</p>
                    <CurveChart
                      points={model.pr || []}
                      xKey="recall"
                      yKey="precision"
                      xLabel="Recall"
                      yLabel="Precision"
                      color={color}
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Subgroup Metrics</p>
            <p className="subtle text-sm mt-2">Slice-based performance helps show where models behave differently across cohorts.</p>
          </div>
          <span className="pill">Equity Check</span>
        </div>
        <div className="card-grid">
          {subgroups?.models?.map((model, index) => (
            <article key={`${model.model}-subgroups`} className="chart-shell stack-md">
              <div className="panel-header">
                <div>
                  <p className="text-xl font-semibold">{model.model}</p>
                  <p className="subtle text-sm mt-1">{model.dataset || "synthea"}</p>
                </div>
                <span className="badge" style={{ background: "color-mix(in srgb, var(--accent-3) 16%, transparent)", color: getColor(index, theme) }}>
                  {model.groups.length} groups
                </span>
              </div>
              <div className="card-grid md:grid-cols-2">
                {model.groups.map((group) => (
                  <div key={`${model.model}-${group.group}`} className="surface stack-sm">
                    <p className="font-semibold">{group.group}</p>
                    <div className="list text-sm">
                      <div>• ROC-AUC: {group.roc_auc?.toFixed(3) ?? "n/a"}</div>
                      <div>• PR-AUC: {group.pr_auc?.toFixed(3) ?? "n/a"}</div>
                      <div>• F1: {group.f1?.toFixed(3) ?? "n/a"}</div>
                      <div>• Brier: {group.brier?.toFixed(3) ?? "n/a"}</div>
                      <div>• Support: {group.support}</div>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">SHAP Feature Importance</p>
            <p className="subtle text-sm mt-2">Feature bars are expanded and color-coded so model-specific drivers are easier to compare.</p>
          </div>
          <span className="pill">Explainability</span>
        </div>
        <div className="card-grid md:grid-cols-2">
          {shap?.models?.map((model, index) => (
            <article key={`${model.model}-shap`} className="chart-shell stack-md">
              <div>
                <p className="text-xl font-semibold">{model.model}</p>
                <p className="subtle text-sm mt-2">{modelDescription(model.model)}</p>
              </div>
              <div className="stack-md">
                {model.features.map((feature) => (
                  <div key={`${model.model}-${feature.name}`} className="stack-sm">
                    <div className="panel-header">
                      <span className="font-medium" title={feature.name}>
                        {formatFeatureName(feature.name)}
                      </span>
                      <strong>{feature.importance.toFixed(4)}</strong>
                    </div>
                    <div className="metric-bar">
                      <span
                        style={{
                          width: `${Math.min(100, feature.importance * 100)}%`,
                          background: getColor(index, theme),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Explainability Workspace</p>
            <p className="subtle text-sm mt-2">
              This brings together feature attribution, graph interpretation, and cohort reasoning so the prediction dashboard feels closer to clinical review.
            </p>
          </div>
          <span className="pill">Why The Model Thinks This</span>
        </div>
        <div className="card-grid md:grid-cols-3">
          {orderedModels.slice(0, 3).map((model, index) => {
            const key = `${model.model}:${model.dataset || "synthea"}`;
            const shapModel = shapMap.get(key);
            const subgroupModel = subgroupMap.get(key);
            const topFeature = shapModel?.features?.[0];
            const mostDifficultGroup = subgroupModel?.groups
              ?.filter((group) => typeof group.roc_auc === "number")
              .sort((a, b) => (a.roc_auc ?? 0) - (b.roc_auc ?? 0))[0];
            const color = getColor(index, theme);

            return (
              <article key={`${model.model}-explainability`} className="surface stack-sm">
                <div className="panel-header">
                  <p className="font-semibold">{model.model}</p>
                  <span className="badge" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
                    Focus model
                  </span>
                </div>
                <p className="subtle text-sm">
                  <strong>SHAP driver:</strong>{" "}
                  {topFeature ? `${formatFeatureName(topFeature.name)} is the strongest current feature signal (${topFeature.importance.toFixed(4)}).` : "Unavailable for this model."}
                </p>
                <p className="subtle text-sm">
                  <strong>Graph evidence path:</strong>{" "}
                  {/graph|gnn|gcn/i.test(model.model)
                    ? "Patient utilization and condition links are being used directly through the graph structure, so connected events matter as much as raw counts."
                    : "This model is not a graph-native learner, so graph evidence is currently interpretive rather than directly learned."}
                </p>
                <p className="subtle text-sm">
                  <strong>Similar-case retrieval:</strong>{" "}
                  {mostDifficultGroup
                    ? `The weakest cohort slice in this run is ${mostDifficultGroup.group}, which is where similar-case review is most valuable.`
                    : "Subgroup retrieval summary is unavailable for this model."}
                </p>
                <p className="subtle text-sm">
                  <strong>Counterfactuals:</strong> Planned next. We can later show how predicted risk changes if visit burden, condition load, or care setting mix changes.
                </p>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
