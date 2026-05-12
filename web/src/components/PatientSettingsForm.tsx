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
};

const STORAGE_KEY = "gojo-theme";

export default function PatientSettingsForm({ initialPreferences }: Props) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>("");

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  }

  async function savePreferences() {
    setSaving(true);
    setNotice("");
    const res = await fetch("/api/settings/patient", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme: preferences.theme,
        chartDensity: preferences.chartDensity,
        showRiskPanels: preferences.showRiskPanels,
        voiceInputEnabled: preferences.voiceInputEnabled,
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
            <p className="section-title">Patient Preferences</p>
            <p className="subtle text-sm mt-2">These settings now persist in the app database and apply to this patient account instead of staying as placeholders.</p>
          </div>
          <span className="pill">Connected</span>
        </div>

        <div className="summary-grid">
          <div className="summary-tile">
            <p className="summary-tile__label">Theme</p>
            <p className="summary-tile__value">{preferences.theme === "dark" ? "Dark" : "Light"}</p>
            <p className="summary-tile__meta">Shared across the patient workspace immediately after save.</p>
          </div>
          <div className="summary-tile">
            <p className="summary-tile__label">Layout Density</p>
            <p className="summary-tile__value">{preferences.chartDensity === "compact" ? "Compact" : "Comfortable"}</p>
            <p className="summary-tile__meta">Stored now so future patient layouts can honor density preference too.</p>
          </div>
          <div className="summary-tile">
            <p className="summary-tile__label">Last Updated</p>
            <p className="summary-tile__value text-[1.05rem]">
              {new Date(preferences.updatedAt).toLocaleString()}
            </p>
            <p className="summary-tile__meta">Saved per account in the same application database.</p>
          </div>
        </div>
      </div>

      <div className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Assistant Controls</p>
            <p className="subtle text-sm mt-2">These patient-facing settings are now persisted and ready for the later document, voice, and appointment features.</p>
          </div>
        </div>

        <div className="card-grid md:grid-cols-2">
          <div className="surface stack-md">
            <label htmlFor="patient-theme">Theme</label>
            <select
              id="patient-theme"
              value={preferences.theme}
              onChange={(event) => update("theme", event.target.value as Preferences["theme"])}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>

          <div className="surface stack-md">
            <label htmlFor="patient-density">Layout Density</label>
            <select
              id="patient-density"
              value={preferences.chartDensity}
              onChange={(event) => update("chartDensity", event.target.value as Preferences["chartDensity"])}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </div>

          <div className="surface stack-md">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={preferences.voiceInputEnabled}
                onChange={(event) => update("voiceInputEnabled", event.target.checked)}
              />
              Enable voice input when patient voice capture is added
            </label>
          </div>

          <div className="surface stack-md">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={preferences.showRiskPanels}
                onChange={(event) => update("showRiskPanels", event.target.checked)}
              />
              Show risk-style emphasis panels when those features appear in patient view
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
