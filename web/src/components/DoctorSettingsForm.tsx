"use client";

import { useState } from "react";

type Preferences = {
  theme: "dark" | "light";
  chartDensity: "comfortable" | "compact";
  showRiskPanels: boolean;
  voiceInputEnabled: boolean;
  doctorCopilotMode: "assist" | "strict";
  updatedAt: string;
};

type Props = {
  initialPreferences: Preferences;
  patientCountLabel: string;
};

const STORAGE_KEY = "gojo-theme";

export default function DoctorSettingsForm({ initialPreferences, patientCountLabel }: Props) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>("");

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  }

  async function savePreferences() {
    setSaving(true);
    setNotice("");
    const res = await fetch("/api/settings/doctor", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme: preferences.theme,
        chartDensity: preferences.chartDensity,
        showRiskPanels: preferences.showRiskPanels,
        voiceInputEnabled: preferences.voiceInputEnabled,
        doctorCopilotMode: preferences.doctorCopilotMode,
      }),
    });

    const data = (await res.json()) as { error?: string; preferences?: Preferences };
    if (!res.ok || !data.preferences) {
      setNotice(data.error || "Unable to save preferences.");
      setSaving(false);
      return;
    }

    setPreferences(data.preferences);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, data.preferences.theme);
      document.documentElement.dataset.theme = data.preferences.theme;
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: data.preferences.theme,
        }),
      );
    }
    setNotice("Preferences saved.");
    setSaving(false);
  }

  return (
    <div className="dashboard-grid">
      <div className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Doctor Preferences</p>
            <p className="subtle text-sm mt-2">These settings now persist in the app database and load automatically for this account.</p>
          </div>
          <span className="pill">Connected</span>
        </div>

        <div className="summary-grid">
          <div className="summary-tile">
            <p className="summary-tile__label">AI Provider</p>
            <p className="summary-tile__value text-[1.1rem]">MiniMax-first</p>
            <p className="summary-tile__meta">Routine QA uses the lighter MiniMax model with SQL caching.</p>
          </div>
          <div className="summary-tile">
            <p className="summary-tile__label">Connected Patients</p>
            <p className="summary-tile__value">{patientCountLabel}</p>
            <p className="summary-tile__meta">Current seeded patient graph size.</p>
          </div>
          <div className="summary-tile">
            <p className="summary-tile__label">Theme</p>
            <p className="summary-tile__value">{preferences.theme === "dark" ? "Dark" : "Light"}</p>
            <p className="summary-tile__meta">Applies to the full app shell and dashboards.</p>
          </div>
          <div className="summary-tile">
            <p className="summary-tile__label">Last Updated</p>
            <p className="summary-tile__value text-[1.05rem]">
              {new Date(preferences.updatedAt).toLocaleString()}
            </p>
            <p className="summary-tile__meta">Saved per user inside the GOJO app database.</p>
          </div>
        </div>
      </div>

      <div className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Workspace Controls</p>
            <p className="subtle text-sm mt-2">Choose how dense the model UI feels, whether risk panels are shown prominently, and how strict the copilot should behave.</p>
          </div>
        </div>

        <div className="card-grid md:grid-cols-2">
          <div className="surface stack-md">
            <label htmlFor="doctor-theme">Theme</label>
            <select
              id="doctor-theme"
              value={preferences.theme}
              onChange={(event) => update("theme", event.target.value as Preferences["theme"])}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>

          <div className="surface stack-md">
            <label htmlFor="doctor-density">Chart Density</label>
            <select
              id="doctor-density"
              value={preferences.chartDensity}
              onChange={(event) => update("chartDensity", event.target.value as Preferences["chartDensity"])}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </div>

          <div className="surface stack-md">
            <label htmlFor="doctor-copilot">Doctor Copilot Mode</label>
            <select
              id="doctor-copilot"
              value={preferences.doctorCopilotMode}
              onChange={(event) => update("doctorCopilotMode", event.target.value as Preferences["doctorCopilotMode"])}
            >
              <option value="assist">Assist</option>
              <option value="strict">Strict</option>
            </select>
          </div>

          <div className="surface stack-md">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={preferences.showRiskPanels}
                onChange={(event) => update("showRiskPanels", event.target.checked)}
              />
              Show risk panels by default
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={preferences.voiceInputEnabled}
                onChange={(event) => update("voiceInputEnabled", event.target.checked)}
              />
              Enable voice input when memo capture is added
            </label>
          </div>
        </div>

        {notice ? (
          <div className={`status-banner ${notice === "Preferences saved." ? "status-banner--success" : "status-banner--error"}`}>
            <span>{notice}</span>
          </div>
        ) : null}

        <div className="input-shell">
          <button className="btn-primary" type="button" onClick={savePreferences} disabled={saving}>
            {saving ? "Saving..." : "Save Preferences"}
          </button>
        </div>
      </div>
    </div>
  );
}
