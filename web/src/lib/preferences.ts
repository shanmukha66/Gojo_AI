import { getDb } from "./db";

export type ThemePreference = "dark" | "light";
export type ChartDensity = "comfortable" | "compact";
export type DoctorCopilotMode = "assist" | "strict";

export type UserPreferences = {
  userId: string;
  theme: ThemePreference;
  chartDensity: ChartDensity;
  showRiskPanels: boolean;
  voiceInputEnabled: boolean;
  doctorCopilotMode: DoctorCopilotMode;
  updatedAt: string;
};

export const DEFAULT_PREFERENCES = {
  theme: "dark" as ThemePreference,
  chartDensity: "comfortable" as ChartDensity,
  showRiskPanels: true,
  voiceInputEnabled: false,
  doctorCopilotMode: "assist" as DoctorCopilotMode,
};

function nowIso() {
  return new Date().toISOString();
}

function toBool(value: unknown) {
  return value === 1 || value === true || value === "1";
}

function mapRow(row: {
  user_id: string;
  theme: string;
  chart_density: string;
  show_risk_panels: number;
  voice_input_enabled: number;
  doctor_copilot_mode: string;
  updated_at: string;
}): UserPreferences {
  return {
    userId: row.user_id,
    theme: row.theme === "light" ? "light" : "dark",
    chartDensity: row.chart_density === "compact" ? "compact" : "comfortable",
    showRiskPanels: toBool(row.show_risk_panels),
    voiceInputEnabled: toBool(row.voice_input_enabled),
    doctorCopilotMode: row.doctor_copilot_mode === "strict" ? "strict" : "assist",
    updatedAt: row.updated_at,
  };
}

export function getUserPreferences(userId: string): UserPreferences {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        user_id,
        theme,
        chart_density,
        show_risk_panels,
        voice_input_enabled,
        doctor_copilot_mode,
        updated_at
      FROM user_preferences
      WHERE user_id = ?`
    )
    .get(userId) as
    | {
        user_id: string;
        theme: string;
        chart_density: string;
        show_risk_panels: number;
        voice_input_enabled: number;
        doctor_copilot_mode: string;
        updated_at: string;
      }
    | undefined;

  if (row) {
    return mapRow(row);
  }

  const preferences: UserPreferences = {
    userId,
    theme: DEFAULT_PREFERENCES.theme,
    chartDensity: DEFAULT_PREFERENCES.chartDensity,
    showRiskPanels: DEFAULT_PREFERENCES.showRiskPanels,
    voiceInputEnabled: DEFAULT_PREFERENCES.voiceInputEnabled,
    doctorCopilotMode: DEFAULT_PREFERENCES.doctorCopilotMode,
    updatedAt: nowIso(),
  };

  db.prepare(
    `INSERT INTO user_preferences
      (user_id, theme, chart_density, show_risk_panels, voice_input_enabled, doctor_copilot_mode, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    preferences.userId,
    preferences.theme,
    preferences.chartDensity,
    preferences.showRiskPanels ? 1 : 0,
    preferences.voiceInputEnabled ? 1 : 0,
    preferences.doctorCopilotMode,
    preferences.updatedAt
  );

  return preferences;
}

export function updateUserPreferences(
  userId: string,
  patch: Partial<{
    theme: ThemePreference;
    chartDensity: ChartDensity;
    showRiskPanels: boolean;
    voiceInputEnabled: boolean;
    doctorCopilotMode: DoctorCopilotMode;
  }>
): UserPreferences {
  const current = getUserPreferences(userId);
  const next: UserPreferences = {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  };

  const db = getDb();
  db.prepare(
    `UPDATE user_preferences
      SET theme = ?,
          chart_density = ?,
          show_risk_panels = ?,
          voice_input_enabled = ?,
          doctor_copilot_mode = ?,
          updated_at = ?
      WHERE user_id = ?`
  ).run(
    next.theme,
    next.chartDensity,
    next.showRiskPanels ? 1 : 0,
    next.voiceInputEnabled ? 1 : 0,
    next.doctorCopilotMode,
    next.updatedAt,
    userId
  );

  return next;
}
