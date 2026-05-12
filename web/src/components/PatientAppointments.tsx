"use client";

import { useMemo, useState } from "react";

type DoctorOption = {
  id: string;
  name: string | null;
  email: string;
};

type SlotOption = {
  doctorId: string;
  doctorName: string | null;
  slotStart: string;
  slotEnd: string;
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
  initialDoctors: DoctorOption[];
  initialSlots: SlotOption[];
  initialAppointments: AppointmentView[];
};

function formatDate(value: string) {
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

export default function PatientAppointments({
  initialDoctors,
  initialSlots,
  initialAppointments,
}: Props) {
  const [appointments, setAppointments] = useState(initialAppointments);
  const [slots, setSlots] = useState(initialSlots);
  const [doctors] = useState(initialDoctors);
  const [doctorId, setDoctorId] = useState(initialDoctors[0]?.id ?? "");
  const [slotStart, setSlotStart] = useState(initialSlots[0]?.slotStart ?? "");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rescheduleById, setRescheduleById] = useState<Record<string, string>>({});

  const doctorSlots = useMemo(
    () => slots.filter((slot) => slot.doctorId === doctorId),
    [slots, doctorId],
  );

  async function refreshAppointments() {
    const res = await fetch("/api/appointments", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) {
      setAppointments(data.appointments || []);
      setSlots(data.availableSlots || []);
      if (!doctorId && data.doctors?.[0]?.id) {
        setDoctorId(data.doctors[0].id);
      }
    }
  }

  async function bookAppointment(event: React.FormEvent) {
    event.preventDefault();
    const selectedSlot = doctorSlots.find((slot) => slot.slotStart === slotStart);
    if (!doctorId || !selectedSlot || !reason.trim()) {
      setNotice("Choose a doctor, pick a slot, and describe the appointment reason.");
      return;
    }

    setLoading(true);
    setNotice(null);
    const res = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doctorId,
        slotStart: selectedSlot.slotStart,
        slotEnd: selectedSlot.slotEnd,
        reason: reason.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error || "Unable to book appointment");
      setLoading(false);
      return;
    }

    setNotice("Appointment request submitted. It will now appear in your upcoming appointments.");
    setReason("");
    await refreshAppointments();
    setLoading(false);
  }

  async function updateAppointment(id: string, payload: Record<string, unknown>) {
    setBusyId(id);
    const res = await fetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error || "Unable to update appointment");
    } else {
      await refreshAppointments();
      setNotice("Appointment updated.");
    }
    setBusyId(null);
  }

  return (
    <div className="dashboard-grid">
      <section className="card-contrast stack-lg">
        <div className="panel-header">
          <div>
            <p className="section-title">Request an appointment</p>
            <p className="subtle text-sm mt-2">
              Select a clinician, choose an available time, and submit your request.
            </p>
          </div>
          <span className="pill">Patient Scheduling</span>
        </div>

        <form onSubmit={bookAppointment} className="stack-md">
          <div className="input-shell">
            <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name || doctor.email}
                </option>
              ))}
            </select>
            <select value={slotStart} onChange={(event) => setSlotStart(event.target.value)}>
              {doctorSlots.length === 0 ? (
                <option value="">No slots available for this doctor yet</option>
              ) : (
                doctorSlots.map((slot) => (
                  <option key={`${slot.doctorId}-${slot.slotStart}`} value={slot.slotStart}>
                    {formatDate(slot.slotStart)}
                  </option>
                ))
              )}
            </select>
          </div>
          <textarea
            placeholder="Describe why you want to book this appointment"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
          />
          <div className="input-shell">
            <button className="btn-primary" type="submit" disabled={loading || doctorSlots.length === 0}>
              {loading ? "Submitting..." : "Request Appointment"}
            </button>
          </div>
          {notice ? (
            <div className={`status-banner ${notice.toLowerCase().includes("unable") ? "status-banner--error" : ""}`}>
              <span>{notice}</span>
            </div>
          ) : null}
        </form>
      </section>

      <section className="card-contrast stack-lg">
          <div className="panel-header">
            <div>
            <p className="section-title">Upcoming appointments</p>
            <p className="subtle text-sm mt-2">
              Review requested, booked, completed, or cancelled visits from the patient portal.
            </p>
          </div>
          <span className="pill">Status Tracking</span>
        </div>

        {appointments.length === 0 ? (
          <div className="empty-state">
            <p className="section-title">No appointments yet</p>
            <p className="subtle text-sm">Your requested or booked appointments will show up here.</p>
          </div>
        ) : (
          <div className="card-grid md:grid-cols-2">
            {appointments.map((appointment) => (
              <article key={appointment.id} className="card stack-sm">
                <div className="panel-header">
                  <div>
                    <p className="font-semibold">{appointment.doctorName || "Doctor"}</p>
                    <p className="subtle text-xs mt-1">{formatDate(appointment.slotStart)}</p>
                  </div>
                  <span className="pill">{appointment.status}</span>
                </div>
                <p className="subtle text-sm leading-7">{appointment.reason}</p>
                {appointment.cancellationReason ? (
                  <p className="muted text-xs">Cancellation reason: {appointment.cancellationReason}</p>
                ) : null}
                {appointment.rescheduledToAppointmentId ? (
                  <p className="muted text-xs">Rescheduled to appointment {appointment.rescheduledToAppointmentId}</p>
                ) : null}
                {appointment.history.length > 0 ? (
                  <div className="stack-sm text-sm">
                    <p className="font-semibold">Status history</p>
                    <div className="list">
                      {appointment.history.map((item) => (
                        <div key={item.id}>• {item.nextStatus} · {formatDate(item.createdAt)}{item.changeReason ? ` · ${item.changeReason}` : ""}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {(appointment.status === "requested" || appointment.status === "booked" || appointment.status === "confirmed") ? (
                  <div className="input-shell compact-actions compact-actions--wrap">
                    <button className="btn-secondary btn-fit" type="button" disabled={busyId === appointment.id} onClick={() => updateAppointment(appointment.id, { status: "cancelled", cancellationReason: "Cancelled by patient" })}>
                      Cancel
                    </button>
                    <select
                      value={rescheduleById[appointment.id] || ""}
                      onChange={(event) => setRescheduleById((prev) => ({ ...prev, [appointment.id]: event.target.value }))}
                    >
                      <option value="">Reschedule to another slot</option>
                      {slots
                        .filter((slot) => slot.doctorId === appointment.doctorId)
                        .map((slot) => (
                          <option key={`${appointment.id}-${slot.slotStart}`} value={slot.slotStart}>
                            {formatDate(slot.slotStart)}
                          </option>
                        ))}
                    </select>
                    <button
                      className="btn-secondary btn-fit"
                      type="button"
                      disabled={busyId === appointment.id || !rescheduleById[appointment.id]}
                      onClick={() => {
                        const slot = slots.find((item) => item.slotStart === rescheduleById[appointment.id]);
                        if (!slot) return;
                        updateAppointment(appointment.id, {
                          slotStart: slot.slotStart,
                          slotEnd: slot.slotEnd,
                          reason: "Patient rescheduled appointment",
                        });
                      }}
                    >
                      Reschedule
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
