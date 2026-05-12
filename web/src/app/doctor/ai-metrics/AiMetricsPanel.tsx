"use client";

import { useEffect, useState } from "react";

type Metrics = {
  usage: Array<{ provider: string; model: string; routeKind: string; calls: number; cacheHits: number; promptTokens: number; completionTokens: number; totalTokens: number }>;
  cache: Array<{ provider: string; model: string; routeKind: string; entries: number; hits: number }>;
  rl: Array<{ actorRole: string; routeKind: string; actionKey: string; events: number; averageReward: number; latestAt: string }>;
  qValues: Array<{ stateKey: string; actionKey: string; qValue: number; visits: number; updatedAt: string }>;
  groundTruth: Array<{ actorRole: string; routeKind: string; scopeKey: string | null; memories: number; reuses: number; averageRelevance: number; latestAt: string }>;
  feedback: Array<{ actorRole: string; routeKind: string; rating: string; count: number; latestAt: string }>;
};

export default function AiMetricsPanel() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/ai/metrics", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Unable to load AI metrics");
        setMetrics(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load AI metrics"));
  }, []);

  if (error) return <div className="status-banner status-banner--error">{error}</div>;
  if (!metrics) return <div className="empty-state">Loading AI usage metrics...</div>;

  const totals = metrics.usage.reduce(
    (acc, row) => ({ calls: acc.calls + Number(row.calls || 0), cacheHits: acc.cacheHits + Number(row.cacheHits || 0), tokens: acc.tokens + Number(row.totalTokens || 0) }),
    { calls: 0, cacheHits: 0, tokens: 0 },
  );
  const cacheRate = totals.calls ? Math.round((totals.cacheHits / totals.calls) * 100) : 0;
  const feedbackTotal = metrics.feedback.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const avgReward = metrics.rl.length ? metrics.rl.reduce((sum, row) => sum + Number(row.averageReward || 0), 0) / metrics.rl.length : 0;

  return (
    <div className="stack-lg">
      <div className="summary-grid">
        <div className="summary-tile">
          <p className="summary-tile__label">AI Calls</p>
          <p className="summary-tile__value">{totals.calls}</p>
          <p className="summary-tile__meta">MiniMax/OpenAI provider calls plus cache reads.</p>
        </div>
        <div className="summary-tile">
          <p className="summary-tile__label">Cache Hit Rate</p>
          <p className="summary-tile__value">{cacheRate}%</p>
          <p className="summary-tile__meta">Higher is better for the MiniMax token plan.</p>
        </div>
        <div className="summary-tile">
          <p className="summary-tile__label">Logged Tokens</p>
          <p className="summary-tile__value">{totals.tokens}</p>
          <p className="summary-tile__meta">Provider-reported tokens from non-fallback AI calls.</p>
        </div>
        <div className="summary-tile">
          <p className="summary-tile__label">Feedback Events</p>
          <p className="summary-tile__value">{feedbackTotal}</p>
          <p className="summary-tile__meta">Doctor/patient ratings feeding the RL reward table.</p>
        </div>
        <div className="summary-tile">
          <p className="summary-tile__label">Avg Reward</p>
          <p className="summary-tile__value">{avgReward.toFixed(2)}</p>
          <p className="summary-tile__meta">Higher means stronger groundedness and user feedback.</p>
        </div>
      </div>

      <section className="card-contrast stack-md">
        <div className="panel-header"><div><p className="section-title">Provider Usage</p><p className="subtle text-sm mt-2">Tracks where MiniMax is being used and how often cache saves repeat calls.</p></div><span className="pill">Cost control</span></div>
        <div className="table-shell">
          <table>
            <thead><tr><th>Route</th><th>Provider</th><th>Model</th><th>Calls</th><th>Cache</th><th>Tokens</th></tr></thead>
            <tbody>{metrics.usage.map((row, index) => <tr key={`usage-${index}`}><td>{row.routeKind}</td><td>{row.provider}</td><td>{row.model}</td><td>{row.calls}</td><td>{row.cacheHits}</td><td>{row.totalTokens}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="card-contrast stack-md">
        <div className="panel-header"><div><p className="section-title">RL Reward Metrics</p><p className="subtle text-sm mt-2">Q-learning-style rewards track groundedness, fallback use, evidence count, and cache behavior.</p></div><span className="pill">Learning signal</span></div>
        <div className="table-shell">
          <table>
            <thead><tr><th>Route</th><th>Action</th><th>Events</th><th>Avg Reward</th><th>Latest</th></tr></thead>
            <tbody>{metrics.rl.map((row, index) => <tr key={`rl-${index}`}><td>{row.routeKind}</td><td>{row.actionKey}</td><td>{row.events}</td><td>{Number(row.averageReward || 0).toFixed(3)}</td><td>{row.latestAt}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="card-contrast stack-md">
        <div className="panel-header"><div><p className="section-title">Human Feedback</p><p className="subtle text-sm mt-2">Doctor feedback buttons convert qualitative review into reward signals for the Q table.</p></div><span className="pill">RL from users</span></div>
        <div className="table-shell">
          <table>
            <thead><tr><th>Role</th><th>Route</th><th>Rating</th><th>Count</th><th>Latest</th></tr></thead>
            <tbody>{metrics.feedback.map((row, index) => <tr key={`feedback-${index}`}><td>{row.actorRole}</td><td>{row.routeKind}</td><td>{row.rating}</td><td>{row.count}</td><td>{row.latestAt}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="card-contrast stack-md">
        <div className="panel-header"><div><p className="section-title">Ground Truth Memory</p><p className="subtle text-sm mt-2">Saved doctor/patient questions, answers, evidence, and relevance scores for reuse when similar questions are asked again.</p></div><span className="pill">Reusable evidence</span></div>
        <div className="table-shell">
          <table>
            <thead><tr><th>Role</th><th>Route</th><th>Scope</th><th>Memories</th><th>Reuses</th><th>Avg Relevance</th><th>Latest</th></tr></thead>
            <tbody>{metrics.groundTruth.map((row, index) => <tr key={`gt-${index}`}><td>{row.actorRole}</td><td>{row.routeKind}</td><td>{row.scopeKey || "global"}</td><td>{row.memories}</td><td>{row.reuses || 0}</td><td>{Number(row.averageRelevance || 0).toFixed(2)}</td><td>{row.latestAt}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="card-contrast stack-md">
        <div className="panel-header"><div><p className="section-title">Q Values</p><p className="subtle text-sm mt-2">This is the early policy table. Later we can use it to pick cheaper vs stronger model paths automatically.</p></div><span className="pill">Q table</span></div>
        <div className="table-shell">
          <table>
            <thead><tr><th>State</th><th>Action</th><th>Q Value</th><th>Visits</th></tr></thead>
            <tbody>{metrics.qValues.map((row, index) => <tr key={`q-${index}`}><td>{row.stateKey}</td><td>{row.actionKey}</td><td>{Number(row.qValue || 0).toFixed(3)}</td><td>{row.visits}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
