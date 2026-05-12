"use client";

import { useMemo, useState } from "react";

type AvailabilityRow = {
  id: string;
  doctorId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type AppointmentView = {
  id: string;
  doctorId: string;
  patientUserId: string | null;
  patientRecordId: string | null;
  slotStart: string;
  slotEnd: string;
  status: "requested" | "booked" | "confirmed" | "completed" | "cancelled" | "rescheduled" | "revisit_suggested";
  reason: string;
  cancellationReason: string | null;
  rescheduledFromAppointmentId: string | null;
  rescheduledToAppointmentId: string | null;
  revisitFromVisitId: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  visitId: string | null;
  createdByRole: string;
  createdAt: string;
  updatedAt: string;
  doctorName: string | null;
  patientName: string | null;
  patientRecordName: string | null;
};

type Props = {
  initialAvailability: AvailabilityRow[];
  initialAppointments: AppointmentView[];
};

type ViewMode = "day" | "week" | "month" | "year";

const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDayLabel(date: Date) {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTimeRange(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${endDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function appointmentTone(status: AppointmentView["status"]) {
  switch (status) {
    case "completed":
      return "var(--success)";
    case "cancelled":
      return "var(--danger)";
    case "confirmed":
      return "var(--accent)";
    case "rescheduled":
      return "var(--warning)";
    case "revisit_suggested":
      return "var(--accent-2)";
    case "booked":
      return "var(--accent)";
    default:
      return "var(--accent-2)";
  }
}

export default function DoctorScheduleBoard({ initialAvailability, initialAppointments }: Props) {
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState(startOfDay(new Date()));

  const appointmentsByDay = useMemo(() => {
    const map = new Map<string, AppointmentView[]>();
    for (const appointment of initialAppointments) {
      const date = startOfDay(new Date(appointment.slotStart));
      const key = date.toISOString();
      const existing = map.get(key) || [];
      existing.push(appointment);
      map.set(key, existing);
    }
    return map;
  }, [initialAppointments]);

  const today = startOfDay(new Date());
  const monthStart = startOfMonth(cursor);
  const monthGridStart = startOfWeek(monthStart);

  const monthDays = useMemo(() => {
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(monthGridStart);
      day.setDate(monthGridStart.getDate() + index);
      return day;
    });
  }, [monthGridStart]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [cursor]);

  const selectedDayAppointments = useMemo(() => {
    return appointmentsByDay.get(startOfDay(cursor).toISOString()) || [];
  }, [appointmentsByDay, cursor]);

  const yearMonths = useMemo(() => {
    return Array.from({ length: 12 }, (_, index) => {
      const month = new Date(cursor.getFullYear(), index, 1);
      const total = initialAppointments.filter((appointment) => {
        const date = new Date(appointment.slotStart);
        return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();
      }).length;
      return { month, total };
    });
  }, [cursor, initialAppointments]);

  function shiftCursor(direction: -1 | 1) {
    const next = new Date(cursor);
    if (view === "day") next.setDate(next.getDate() + direction);
    if (view === "week") next.setDate(next.getDate() + direction * 7);
    if (view === "month") next.setMonth(next.getMonth() + direction);
    if (view === "year") next.setFullYear(next.getFullYear() + direction);
    setCursor(next);
  }

  return (
    <div className="dashboard-grid">
      <section className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Doctor Timetable</p>
            <p className="subtle text-sm mt-2">
              Track workload by day, week, month, and year so appointments and availability do not feel buried inside the main workspace.
            </p>
          </div>
          <span className="pill">Schedule Center</span>
        </div>

        <div className="calendar-toolbar">
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            {(["day", "week", "month", "year"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                style={{
                  borderRadius: "999px",
                  border:
                    view === mode
                      ? "1px solid color-mix(in srgb, var(--accent) 34%, var(--stroke))"
                      : "1px solid var(--stroke)",
                  background:
                    view === mode
                      ? "color-mix(in srgb, var(--accent) 15%, var(--panel))"
                      : "color-mix(in srgb, var(--panel-soft) 84%, transparent)",
                  color: view === mode ? "var(--ink)" : "var(--ink-muted)",
                  padding: "10px 16px",
                  fontWeight: 700,
                  boxShadow: view === mode ? "var(--ring-accent)" : "none",
                }}
                onClick={() => setView(mode)}
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <button type="button" className="btn-secondary" onClick={() => shiftCursor(-1)}>
              Prev
            </button>
            <button type="button" className="btn-secondary" onClick={() => setCursor(today)}>
              Today
            </button>
            <button type="button" className="btn-secondary" onClick={() => shiftCursor(1)}>
              Next
            </button>
          </div>
        </div>

        <div className="panel-header">
          <div>
            <p className="text-3xl font-semibold">
              {view === "year"
                ? cursor.getFullYear()
                : `${monthNames[cursor.getMonth()]} ${cursor.getFullYear()}`}
            </p>
            <p className="subtle text-sm mt-2">
              {view === "day"
                ? `Focused view for ${formatDayLabel(cursor)}`
                : view === "week"
                  ? `Weekly planning from ${formatDayLabel(weekDays[0])} to ${formatDayLabel(weekDays[6])}`
                  : view === "month"
                    ? "Monthly grid for workload planning and patient follow-up visibility."
                    : "Yearly overview to spot seasonality, load changes, and appointment concentration."}
            </p>
          </div>
          <span className="badge">{initialAppointments.length} appointments tracked</span>
        </div>

        {view === "month" ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gap: "10px",
            }}
          >
            {weekdayNames.map((day) => (
              <div
                key={day}
                style={{
                  padding: "10px 12px",
                  color: "var(--ink-muted)",
                  fontSize: "0.84rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                {day.slice(0, 3)}
              </div>
            ))}
            {monthDays.map((day) => {
              const key = startOfDay(day).toISOString();
              const dayAppointments = appointmentsByDay.get(key) || [];
              const inCurrentMonth = day.getMonth() === cursor.getMonth();
              return (
                <button
                  key={key}
                  type="button"
                  className={`calendar-day ${sameDay(day, cursor) ? "calendar-day--selected" : ""} ${inCurrentMonth ? "" : "calendar-day--muted"}`}
                  onClick={() => {
                    setCursor(day);
                    setView("day");
                  }}
                >
                  <span className="calendar-day__date">{day.getDate()}</span>
                  <div className="calendar-day__events">
                    {dayAppointments.slice(0, 3).map((appointment) => (
                      <span
                        key={appointment.id}
                        className="calendar-event-chip"
                        style={{
                          background: `color-mix(in srgb, ${appointmentTone(appointment.status)} 18%, transparent)`,
                          color: appointmentTone(appointment.status),
                        }}
                      >
                        {appointment.patientRecordName || appointment.patientName || "Patient"}
                      </span>
                    ))}
                    {dayAppointments.length > 3 ? (
                      <span className="calendar-day__more">+{dayAppointments.length - 3} more</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}

        {view === "week" ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gap: "12px",
            }}
          >
            {weekDays.map((day) => {
              const items = appointmentsByDay.get(startOfDay(day).toISOString()) || [];
              return (
                <div key={day.toISOString()} style={{ display: "grid", gap: "12px", alignContent: "start" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "12px 14px",
                      borderRadius: "18px",
                      border: "1px solid var(--stroke)",
                      background: "color-mix(in srgb, var(--panel) 88%, transparent)",
                    }}
                  >
                    <strong>{weekdayNames[day.getDay()].slice(0, 3)}</strong>
                    <span>{day.getDate()}</span>
                  </div>
                  <div className="stack-sm">
                    {items.length > 0 ? (
                      items.map((appointment) => (
                        <div key={appointment.id} className="surface stack-sm">
                          <div className="panel-header">
                            <strong>{appointment.patientRecordName || appointment.patientName || "Patient"}</strong>
                            <span className="pill">{appointment.status}</span>
                          </div>
                          <p className="subtle text-sm">{formatTimeRange(appointment.slotStart, appointment.slotEnd)}</p>
                          <p className="muted text-xs">{appointment.reason}</p>
                        </div>
                      ))
                    ) : (
                      <div className="empty-state">
                        <p className="subtle text-sm">No appointments</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {view === "day" ? (
          <div className="dashboard-grid dashboard-grid--split">
            <div className="surface stack-md">
              <div>
                <p className="eyebrow">Day View</p>
                <p className="text-xl font-semibold mt-2">{formatDayLabel(cursor)}</p>
              </div>
              {selectedDayAppointments.length > 0 ? (
                <div className="stack-sm">
                  {selectedDayAppointments.map((appointment) => (
                    <div key={appointment.id} className="card stack-sm">
                      <div className="panel-header">
                        <strong>{appointment.patientRecordName || appointment.patientName || "Patient"}</strong>
                        <span className="pill">{appointment.status}</span>
                      </div>
                      <p className="subtle text-sm">{formatTimeRange(appointment.slotStart, appointment.slotEnd)}</p>
                      <p className="muted text-xs">{appointment.reason}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <p className="section-title">Clear day</p>
                  <p className="subtle text-sm">No patient visits are booked for this selected day.</p>
                </div>
              )}
            </div>
            <div className="surface stack-md">
              <div>
                <p className="eyebrow">Availability Pattern</p>
                <p className="text-xl font-semibold mt-2">Standing timetable</p>
              </div>
              <div className="list text-sm">
                {initialAvailability.length > 0 ? (
                  initialAvailability
                    .filter((entry) => entry.active)
                    .map((entry) => (
                      <div key={entry.id}>
                        • {weekdayNames[entry.weekday]} · {entry.startTime}-{entry.endTime} · {entry.slotMinutes} min
                      </div>
                    ))
                ) : (
                  <div>• No saved availability blocks yet.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {view === "year" ? (
          <div className="card-grid md:grid-cols-3">
            {yearMonths.map(({ month, total }) => (
              <button
                key={month.toISOString()}
                type="button"
                className="surface stack-sm text-left"
                onClick={() => {
                  setCursor(month);
                  setView("month");
                }}
              >
                <div className="panel-header">
                  <strong>{monthNames[month.getMonth()]}</strong>
                  <span className="pill">{total} visits</span>
                </div>
                <p className="subtle text-sm">
                  {total > 0
                    ? `${total} appointment${total === 1 ? "" : "s"} scheduled in this month.`
                    : "No appointments scheduled yet in this month."}
                </p>
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
