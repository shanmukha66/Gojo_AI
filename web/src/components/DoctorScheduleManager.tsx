"use client";

import { useState } from "react";

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
  history: {
    id: string;
    nextStatus: string;
    changeReason: string | null;
    createdAt: string;
  }[];
};

type Props = {
  initialAvailability: AvailabilityRow[];
  initialAppointments: AppointmentView[];
};

type AvailabilityEditor = {
  weekday: string;
  startTime: string;
  endTime: string;
  slotMinutes: string;
};

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || "Unexpected response" };
  }
}

function weekdayLabel(value: number) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][value] || "Unknown";
}

function formatDate(value?: string | null) {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DoctorScheduleManager({ initialAvailability, initialAppointments }: Props) {
  const [availability, setAvailability] = useState(initialAvailability);
  const [appointments, setAppointments] = useState(initialAppointments);
  const [editor, setEditor] = useState<AvailabilityEditor>({
    weekday: "1",
    startTime: "09:00",
    endTime: "17:00",
    slotMinutes: "30",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rescheduleState, setRescheduleState] = useState<Record<string, { slotStart: string; slotEnd: string; reason: string }>>({});

  async function refresh() {
    const [availabilityRes, appointmentsRes] = await Promise.all([
      fetch("/api/doctor/availability", { cache: "no-store" }),
      fetch("/api/doctor/appointments", { cache: "no-store" }),
    ]);
    const [availabilityData, appointmentsData] = await Promise.all([
      safeJson(availabilityRes),
      safeJson(appointmentsRes),
    ]);
    if (availabilityRes.ok) {
      setAvailability(availabilityData.availability || []);
    }
    if (appointmentsRes.ok) {
      setAppointments(appointmentsData.appointments || []);
    }
  }

  async function saveAvailability(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/doctor/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weekday: Number(editor.weekday),
        startTime: editor.startTime,
        endTime: editor.endTime,
        slotMinutes: Number(editor.slotMinutes),
        active: true,
      }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Failed to save availability");
    } else {
      await refresh();
    }
    setLoading(false);
  }

  async function deleteAvailability(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/doctor/availability/${id}`, { method: "DELETE" });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Failed to delete availability");
    } else {
      await refresh();
    }
    setBusyId(null);
  }

  async function updateAppointment(id: string, status: AppointmentView["status"], cancellationReason?: string) {
    setBusyId(id);
    const res = await fetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, cancellationReason }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Failed to update appointment");
    } else {
      await refresh();
    }
    setBusyId(null);
  }

  async function reschedule(id: string) {
    const state = rescheduleState[id];
    if (!state?.slotStart || !state.slotEnd) {
      setError("Choose a replacement slot before rescheduling.");
      return;
    }
    setBusyId(id);
    const res = await fetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slotStart: state.slotStart,
        slotEnd: state.slotEnd,
        reason: state.reason || "Appointment rescheduled",
      }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Failed to reschedule appointment");
    } else {
      await refresh();
    }
    setBusyId(null);
  }

  async function deleteAppointment(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/appointments/${id}`, { method: "DELETE" });
    const data = await safeJson(res);
    if (!res.ok) {
      setError(data.error || "Failed to delete appointment");
    } else {
      await refresh();
    }
    setBusyId(null);
  }

  return (
    <section className="card-contrast stack-lg fade-up" style={{ animationDelay: "180ms" }}>
      <div className="panel-header">
        <div>
          <p className="section-title">Schedule Management</p>
          <p className="subtle text-sm mt-2">
            Availability and appointment actions are saved in SQL and exported in the background, so the timetable is not just visual.
          </p>
        </div>
        <span className="pill">SQL + CSV</span>
      </div>

      {error ? (
        <div className="status-banner status-banner--error">
          <strong>Issue</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="dashboard-grid dashboard-grid--split">
        <form className="surface stack-md" onSubmit={saveAvailability}>
          <div>
            <p className="eyebrow">Doctor timetable</p>
            <p className="text-lg font-semibold mt-2">Add availability</p>
          </div>
          <div className="input-shell">
            <select value={editor.weekday} onChange={(event) => setEditor((prev) => ({ ...prev, weekday: event.target.value }))}>
              {Array.from({ length: 7 }, (_, index) => (
                <option key={index} value={String(index)}>
                  {weekdayLabel(index)}
                </option>
              ))}
            </select>
            <input type="time" value={editor.startTime} onChange={(event) => setEditor((prev) => ({ ...prev, startTime: event.target.value }))} />
            <input type="time" value={editor.endTime} onChange={(event) => setEditor((prev) => ({ ...prev, endTime: event.target.value }))} />
            <input
              type="number"
              min="15"
              step="15"
              value={editor.slotMinutes}
              onChange={(event) => setEditor((prev) => ({ ...prev, slotMinutes: event.target.value }))}
              placeholder="Slot length"
            />
          </div>
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? "Saving..." : "Add Availability"}
          </button>

          {availability.length > 0 ? (
            <div className="stack-sm">
              {availability.map((item) => (
                <div key={item.id} className="card stack-sm">
                  <div className="panel-header">
                    <div>
                      <p className="font-semibold">
                        {weekdayLabel(item.weekday)} · {item.startTime}-{item.endTime}
                      </p>
                      <p className="subtle text-xs mt-1">{item.slotMinutes} min · {item.active ? "active" : "inactive"}</p>
                    </div>
                    <button className="btn-secondary" type="button" onClick={() => deleteAvailability(item.id)} disabled={busyId === item.id}>
                      {busyId === item.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p className="section-title">No timetable entries yet</p>
              <p className="subtle text-sm">Add at least one availability block so patients can book you.</p>
            </div>
          )}
        </form>

        <div className="surface stack-md">
          <div>
            <p className="eyebrow">Upcoming appointments</p>
            <p className="text-lg font-semibold mt-2">Doctor appointment management</p>
          </div>
          {appointments.length === 0 ? (
            <div className="empty-state">
              <p className="section-title">No appointments yet</p>
              <p className="subtle text-sm">Patient requests and directly booked visits will appear here.</p>
            </div>
          ) : (
            <div className="stack-md">
              {appointments.map((appointment) => (
                <div key={appointment.id} className="card stack-sm">
                  <div className="panel-header">
                    <div>
                      <p className="font-semibold">{appointment.patientName || appointment.patientRecordName || "Patient"}</p>
                      <p className="subtle text-xs mt-1">{formatDate(appointment.slotStart)}</p>
                    </div>
                    <span className="pill">{appointment.status}</span>
                  </div>
                  <p className="subtle text-sm leading-7">{appointment.reason}</p>
                  {appointment.cancellationReason ? (
                    <p className="muted text-xs">Cancellation reason: {appointment.cancellationReason}</p>
                  ) : null}
                  {appointment.history.length > 0 ? (
                    <div className="stack-sm text-sm">
                      <p className="font-semibold">Status timeline</p>
                      <div className="list">
                        {appointment.history.map((item) => (
                          <div key={item.id}>• {item.nextStatus} · {formatDate(item.createdAt)}{item.changeReason ? ` · ${item.changeReason}` : ""}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="input-shell">
                    <button className="btn-secondary" type="button" disabled={busyId === appointment.id} onClick={() => updateAppointment(appointment.id, "confirmed")}>
                      Confirm
                    </button>
                    <button className="btn-secondary" type="button" disabled={busyId === appointment.id} onClick={() => updateAppointment(appointment.id, "completed")}>
                      Complete
                    </button>
                    <button className="btn-secondary" type="button" disabled={busyId === appointment.id} onClick={() => updateAppointment(appointment.id, "cancelled", "Cancelled by doctor")}>
                      Cancel
                    </button>
                    <button className="btn-secondary" type="button" disabled={busyId === appointment.id} onClick={() => deleteAppointment(appointment.id)}>
                      Delete
                    </button>
                  </div>
                  {(appointment.status === "requested" || appointment.status === "booked" || appointment.status === "confirmed") ? (
                    <div className="surface stack-sm">
                      <p className="eyebrow">Reschedule</p>
                      <div className="input-shell input-shell--compact">
                        <input
                          type="datetime-local"
                          value={rescheduleState[appointment.id]?.slotStart || ""}
                          onChange={(event) =>
                            setRescheduleState((prev) => {
                              const start = event.target.value;
                              const end = start ? new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString().slice(0, 16) : "";
                              return { ...prev, [appointment.id]: { slotStart: start, slotEnd: end, reason: prev[appointment.id]?.reason || "Appointment rescheduled" } };
                            })
                          }
                        />
                        <input
                          placeholder="Reschedule reason"
                          value={rescheduleState[appointment.id]?.reason || ""}
                          onChange={(event) =>
                            setRescheduleState((prev) => ({
                              ...prev,
                              [appointment.id]: {
                                slotStart: prev[appointment.id]?.slotStart || "",
                                slotEnd: prev[appointment.id]?.slotEnd || "",
                                reason: event.target.value,
                              },
                            }))
                          }
                        />
                        <button className="btn-secondary btn-fit" type="button" disabled={busyId === appointment.id} onClick={() => reschedule(appointment.id)}>
                          Reschedule
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {appointment.status === "completed" && appointment.patientRecordId && appointment.visitId ? (
                    <div className="input-shell compact-actions compact-actions--wrap">
                      <a className="btn-secondary btn-fit" href={`/doctor/patients/${appointment.patientRecordId}/reviews`}>
                        Create review
                      </a>
                      <button
                        className="btn-secondary btn-fit"
                        type="button"
                        disabled={busyId === appointment.id}
                        onClick={async () => {
                          const proposed = new Date(new Date(appointment.slotStart).getTime() + 7 * 24 * 60 * 60 * 1000);
                          const end = new Date(proposed.getTime() + 30 * 60 * 1000);
                          setBusyId(appointment.id);
                          const res = await fetch("/api/appointments", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              patientRecordId: appointment.patientRecordId,
                              slotStart: proposed.toISOString(),
                              slotEnd: end.toISOString(),
                              reason: `Follow-up revisit for ${appointment.patientRecordName || "patient"}`,
                              revisitFromVisitId: appointment.visitId,
                            }),
                          });
                          const data = await safeJson(res);
                          if (!res.ok) {
                            setError(data.error || "Failed to suggest revisit");
                          } else {
                            await refresh();
                          }
                          setBusyId(null);
                        }}
                      >
                        Suggest revisit
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
