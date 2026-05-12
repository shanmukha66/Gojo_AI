import crypto from "crypto";
import { getDb } from "./db";
import { type Role } from "./auth";
import { assignDoctorToPatient, requireDoctorPatientAccess } from "./clinicalOwnership";
import { getOrCreatePatientRecordLink, getPatientRecordLink, getUserIdsForPatientRecord } from "./patientRecordLink";
import { runQuery } from "./neo4j";
import { exportDoctorAppointmentsCsv, exportDoctorAvailabilityCsv } from "./recordExports";

export type DoctorOption = {
  id: string;
  name: string | null;
  email: string;
};

export type AvailabilityRow = {
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

export type AppointmentStatus =
  | "requested"
  | "booked"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "rescheduled"
  | "revisit_suggested";

export type AppointmentRow = {
  id: string;
  doctorId: string;
  patientUserId: string | null;
  patientRecordId: string | null;
  slotStart: string;
  slotEnd: string;
  status: AppointmentStatus;
  reason: string;
  createdByRole: Role;
  createdAt: string;
  updatedAt: string;
  cancellationReason: string | null;
  rescheduledFromAppointmentId: string | null;
  rescheduledToAppointmentId: string | null;
  revisitFromVisitId: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  visitId: string | null;
};

export type AppointmentHistoryRow = {
  id: string;
  appointmentId: string;
  previousStatus: AppointmentStatus | null;
  nextStatus: AppointmentStatus;
  changedByUserId: string | null;
  changeReason: string | null;
  createdAt: string;
};

export type AppointmentView = AppointmentRow & {
  doctorName: string | null;
  patientName: string | null;
  patientRecordName: string | null;
  history: AppointmentHistoryRow[];
};

export type SlotOption = {
  doctorId: string;
  doctorName: string | null;
  slotStart: string;
  slotEnd: string;
};

export type VisitRow = {
  id: string;
  doctorId: string;
  patientUserId: string | null;
  patientRecordId: string;
  appointmentId: string | null;
  reason: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VisitEventRow = {
  id: string;
  visitId: string;
  eventType: string;
  title: string;
  description: string | null;
  eventAt: string;
  createdAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

function mapAvailability(row: {
  id: string;
  doctor_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  active: number;
  created_at: string;
  updated_at: string;
}): AvailabilityRow {
  return {
    id: row.id,
    doctorId: row.doctor_id,
    weekday: Number(row.weekday),
    startTime: row.start_time,
    endTime: row.end_time,
    slotMinutes: Number(row.slot_minutes),
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAppointment(row: {
  id: string;
  doctor_id: string;
  patient_user_id: string | null;
  patient_record_id: string | null;
  slot_start: string;
  slot_end: string;
  status: AppointmentStatus;
  reason: string;
  created_by_role: Role;
  created_at: string;
  updated_at: string;
  cancellation_reason: string | null;
  rescheduled_from_appointment_id: string | null;
  rescheduled_to_appointment_id: string | null;
  revisit_from_visit_id: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  visit_id: string | null;
}): AppointmentRow {
  return {
    id: row.id,
    doctorId: row.doctor_id,
    patientUserId: row.patient_user_id,
    patientRecordId: row.patient_record_id,
    slotStart: row.slot_start,
    slotEnd: row.slot_end,
    status: row.status,
    reason: row.reason,
    createdByRole: row.created_by_role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancellationReason: row.cancellation_reason,
    rescheduledFromAppointmentId: row.rescheduled_from_appointment_id,
    rescheduledToAppointmentId: row.rescheduled_to_appointment_id,
    revisitFromVisitId: row.revisit_from_visit_id,
    confirmedAt: row.confirmed_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    visitId: row.visit_id,
  };
}

function mapVisit(row: {
  id: string;
  doctor_id: string;
  patient_user_id: string | null;
  patient_record_id: string;
  appointment_id: string | null;
  reason: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}): VisitRow {
  return {
    id: row.id,
    doctorId: row.doctor_id,
    patientUserId: row.patient_user_id,
    patientRecordId: row.patient_record_id,
    appointmentId: row.appointment_id,
    reason: row.reason,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createStatusHistory(input: {
  appointmentId: string;
  previousStatus: AppointmentStatus | null;
  nextStatus: AppointmentStatus;
  changedByUserId?: string | null;
  changeReason?: string | null;
}) {
  const db = getDb();
  db.prepare(
    `INSERT INTO appointment_status_history
      (id, appointment_id, previous_status, next_status, changed_by_user_id, change_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    input.appointmentId,
    input.previousStatus ?? null,
    input.nextStatus,
    input.changedByUserId ?? null,
    input.changeReason ?? null,
    nowIso(),
  );
}

function parseTimeMinutes(value: string) {
  const [hours, minutes] = value.split(":").map((item) => Number(item));
  return hours * 60 + minutes;
}

function overlaps(startA: string, endA: string, startB: string, endB: string) {
  return new Date(startA) < new Date(endB) && new Date(endA) > new Date(startB);
}

function getAppointmentRow(id: string) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, doctor_id, patient_user_id, patient_record_id, slot_start, slot_end, status, reason, created_by_role, created_at, updated_at,
              cancellation_reason, rescheduled_from_appointment_id, rescheduled_to_appointment_id, revisit_from_visit_id,
              confirmed_at, completed_at, cancelled_at, visit_id
       FROM appointments
       WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        doctor_id: string;
        patient_user_id: string | null;
        patient_record_id: string | null;
        slot_start: string;
        slot_end: string;
        status: AppointmentStatus;
        reason: string;
        created_by_role: Role;
        created_at: string;
        updated_at: string;
        cancellation_reason: string | null;
        rescheduled_from_appointment_id: string | null;
        rescheduled_to_appointment_id: string | null;
        revisit_from_visit_id: string | null;
        confirmed_at: string | null;
        completed_at: string | null;
        cancelled_at: string | null;
        visit_id: string | null;
      }
    | undefined;
  return row ? mapAppointment(row) : null;
}

function getBlockedAppointments(doctorId: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, doctor_id, patient_user_id, patient_record_id, slot_start, slot_end, status, reason, created_by_role, created_at, updated_at,
              cancellation_reason, rescheduled_from_appointment_id, rescheduled_to_appointment_id, revisit_from_visit_id,
              confirmed_at, completed_at, cancelled_at, visit_id
       FROM appointments
       WHERE doctor_id = ? AND status IN ('requested', 'booked', 'confirmed', 'revisit_suggested')`,
    )
    .all(doctorId) as Array<{
      id: string;
      doctor_id: string;
      patient_user_id: string | null;
      patient_record_id: string | null;
      slot_start: string;
      slot_end: string;
      status: AppointmentStatus;
      reason: string;
      created_by_role: Role;
      created_at: string;
      updated_at: string;
      cancellation_reason: string | null;
      rescheduled_from_appointment_id: string | null;
      rescheduled_to_appointment_id: string | null;
      revisit_from_visit_id: string | null;
      confirmed_at: string | null;
      completed_at: string | null;
      cancelled_at: string | null;
      visit_id: string | null;
    }>;
  return rows.map(mapAppointment);
}

function getDoctorNameMap() {
  const db = getDb();
  return new Map(
    (db.prepare("SELECT id, name FROM users WHERE role = 'DOCTOR'").all() as Array<{ id: string; name: string | null }>).map((row) => [
      row.id,
      row.name,
    ]),
  );
}

function getPatientNameMap() {
  const db = getDb();
  return new Map(
    (db.prepare("SELECT id, name FROM users WHERE role = 'PATIENT'").all() as Array<{ id: string; name: string | null }>).map((row) => [
      row.id,
      row.name,
    ]),
  );
}

async function resolvePatientRecordNames(recordIds: string[]) {
  const uniqueIds = Array.from(new Set(recordIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map<string, string>();
  const rows = await runQuery<{ p: { id: string; name?: string } }>(
    `MATCH (p:Patient)
     WHERE p.id IN $ids
     RETURN p { .id, .name } AS p`,
    { ids: uniqueIds },
  );
  return new Map(rows.map((row) => [String(row.p.id), row.p.name || `Patient ${row.p.id}`]));
}

async function enrichAppointments(rows: AppointmentRow[]): Promise<AppointmentView[]> {
  const doctorMap = getDoctorNameMap();
  const patientMap = getPatientNameMap();
  const recordNames = await resolvePatientRecordNames(rows.map((row) => row.patientRecordId || ""));
  return rows.map((row) => ({
    ...row,
    doctorName: doctorMap.get(row.doctorId) || null,
    patientName: row.patientUserId ? patientMap.get(row.patientUserId) || null : null,
    patientRecordName: row.patientRecordId ? recordNames.get(row.patientRecordId) || null : null,
    history: listAppointmentHistory(row.id),
  }));
}

export function listDoctors(): DoctorOption[] {
  const db = getDb();
  return db
    .prepare("SELECT id, name, email FROM users WHERE role = 'DOCTOR' ORDER BY COALESCE(name, email) ASC")
    .all() as DoctorOption[];
}

export function listDoctorAvailability(doctorId: string): AvailabilityRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, doctor_id, weekday, start_time, end_time, slot_minutes, active, created_at, updated_at
       FROM doctor_availability
       WHERE doctor_id = ?
       ORDER BY weekday ASC, start_time ASC`,
    )
    .all(doctorId) as Array<{
      id: string;
      doctor_id: string;
      weekday: number;
      start_time: string;
      end_time: string;
      slot_minutes: number;
      active: number;
      created_at: string;
      updated_at: string;
    }>;
  return rows.map(mapAvailability);
}

export function createDoctorAvailability(
  doctorId: string,
  input: { weekday: number; startTime: string; endTime: string; slotMinutes: number; active?: boolean },
) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO doctor_availability
      (id, doctor_id, weekday, start_time, end_time, slot_minutes, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    doctorId,
    input.weekday,
    input.startTime,
    input.endTime,
    input.slotMinutes,
    input.active === false ? 0 : 1,
    now,
    now,
  );
  exportDoctorAvailabilityCsv(doctorId);
  return listDoctorAvailability(doctorId).find((item) => item.id === id) ?? null;
}

export function deleteDoctorAvailability(doctorId: string, availabilityId: string) {
  const db = getDb();
  const result = db.prepare("DELETE FROM doctor_availability WHERE id = ? AND doctor_id = ?").run(availabilityId, doctorId);
  exportDoctorAvailabilityCsv(doctorId);
  return result.changes > 0;
}

export function listBookableSlots(days = 14): SlotOption[] {
  const doctors = listDoctors();
  const now = new Date();
  const slots: SlotOption[] = [];

  for (const doctor of doctors) {
    const availability = listDoctorAvailability(doctor.id).filter((item) => item.active);
    const blocked = getBlockedAppointments(doctor.id);

    for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
      const current = new Date(now);
      current.setHours(0, 0, 0, 0);
      current.setDate(now.getDate() + dayOffset);
      const weekday = current.getDay();
      const dayAvailability = availability.filter((item) => item.weekday === weekday);

      for (const entry of dayAvailability) {
        const startMinutes = parseTimeMinutes(entry.startTime);
        const endMinutes = parseTimeMinutes(entry.endTime);
        const slotMinutes = Math.max(15, entry.slotMinutes);
        for (let minute = startMinutes; minute + slotMinutes <= endMinutes; minute += slotMinutes) {
          const slotStart = new Date(current);
          slotStart.setMinutes(minute);
          const slotEnd = new Date(current);
          slotEnd.setMinutes(minute + slotMinutes);
          if (slotStart <= now) continue;
          if (blocked.some((item) => overlaps(slotStart.toISOString(), slotEnd.toISOString(), item.slotStart, item.slotEnd))) {
            continue;
          }
          slots.push({
            doctorId: doctor.id,
            doctorName: doctor.name,
            slotStart: slotStart.toISOString(),
            slotEnd: slotEnd.toISOString(),
          });
        }
      }
    }
  }

  return slots.slice(0, 60);
}

function createVisitFromAppointment(appointment: AppointmentRow) {
  if (!appointment.patientRecordId) {
    return null;
  }

  assignDoctorToPatient({
    doctorId: appointment.doctorId,
    patientRecordId: appointment.patientRecordId,
    patientUserId: appointment.patientUserId,
    source: "completed_appointment",
  });

  const db = getDb();
  const existing = appointment.visitId
    ? (db
        .prepare(
          `SELECT id, doctor_id, patient_user_id, patient_record_id, appointment_id, reason, status, started_at, ended_at, created_at, updated_at
           FROM visits
           WHERE id = ?`,
        )
        .get(appointment.visitId) as
        | {
            id: string;
            doctor_id: string;
            patient_user_id: string | null;
            patient_record_id: string;
            appointment_id: string | null;
            reason: string | null;
            status: string;
            started_at: string;
            ended_at: string | null;
            created_at: string;
            updated_at: string;
          }
        | undefined)
    : undefined;

  if (existing) {
    return mapVisit(existing);
  }

  const now = nowIso();
  const visitId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO visits
      (id, doctor_id, patient_user_id, patient_record_id, appointment_id, reason, status, started_at, ended_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)`,
  ).run(
    visitId,
    appointment.doctorId,
    appointment.patientUserId,
    appointment.patientRecordId,
    appointment.id,
    appointment.reason,
    appointment.slotStart,
    appointment.slotEnd,
    now,
    now,
  );
  db.prepare(
    `INSERT INTO visit_events
      (id, visit_id, event_type, title, description, event_at, created_at)
     VALUES (?, ?, 'follow_up', 'Appointment completed', ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    visitId,
    appointment.reason,
    appointment.slotEnd,
    now,
  );
  db.prepare("UPDATE appointments SET visit_id = ?, updated_at = ? WHERE id = ?").run(visitId, now, appointment.id);

  return mapVisit({
    id: visitId,
    doctor_id: appointment.doctorId,
    patient_user_id: appointment.patientUserId,
    patient_record_id: appointment.patientRecordId,
    appointment_id: appointment.id,
    reason: appointment.reason,
    status: "completed",
    started_at: appointment.slotStart,
    ended_at: appointment.slotEnd,
    created_at: now,
    updated_at: now,
  });
}

export function createAppointment(input: {
  doctorId: string;
  patientUserId?: string | null;
  patientRecordId?: string | null;
  slotStart: string;
  slotEnd: string;
  status?: AppointmentStatus;
  reason: string;
  createdByRole: Role;
  rescheduledFromAppointmentId?: string | null;
  revisitFromVisitId?: string | null;
}) {
  const conflicting = getBlockedAppointments(input.doctorId).find((item) =>
    overlaps(input.slotStart, input.slotEnd, item.slotStart, item.slotEnd),
  );
  if (conflicting) {
    throw new Error("That appointment slot is already in use.");
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  const status = input.status || "requested";
  db.prepare(
    `INSERT INTO appointments
      (id, doctor_id, patient_user_id, patient_record_id, slot_start, slot_end, status, reason, created_by_role, created_at, updated_at,
       cancellation_reason, rescheduled_from_appointment_id, rescheduled_to_appointment_id, revisit_from_visit_id, confirmed_at, completed_at, cancelled_at, visit_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    input.doctorId,
    input.patientUserId ?? null,
    input.patientRecordId ?? null,
    input.slotStart,
    input.slotEnd,
    status,
    input.reason,
    input.createdByRole,
    now,
    now,
    input.rescheduledFromAppointmentId ?? null,
    input.revisitFromVisitId ?? null,
    status === "confirmed" ? now : null,
    status === "completed" ? now : null,
    status === "cancelled" ? now : null,
  );
  createStatusHistory({
    appointmentId: id,
    previousStatus: null,
    nextStatus: status,
    changeReason: input.reason,
  });
  if (input.patientRecordId) {
    assignDoctorToPatient({
      doctorId: input.doctorId,
      patientRecordId: input.patientRecordId,
      patientUserId: input.patientUserId,
      source: input.createdByRole === "DOCTOR" ? "doctor_booking" : "patient_request",
    });
  }
  exportDoctorAppointmentsCsv(input.doctorId);
  return id;
}

export function listAppointmentHistory(appointmentId: string): AppointmentHistoryRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, appointment_id, previous_status, next_status, changed_by_user_id, change_reason, created_at
       FROM appointment_status_history
       WHERE appointment_id = ?
       ORDER BY created_at ASC`,
    )
    .all(appointmentId) as Array<{
      id: string;
      appointment_id: string;
      previous_status: AppointmentStatus | null;
      next_status: AppointmentStatus;
      changed_by_user_id: string | null;
      change_reason: string | null;
      created_at: string;
    }>;
  return rows.map((row) => ({
    id: row.id,
    appointmentId: row.appointment_id,
    previousStatus: row.previous_status,
    nextStatus: row.next_status,
    changedByUserId: row.changed_by_user_id,
    changeReason: row.change_reason,
    createdAt: row.created_at,
  }));
}

function assertAppointmentAccess(appointment: AppointmentRow, actor: { userId: string; role: Role }) {
  if (actor.role === "DOCTOR" && appointment.doctorId !== actor.userId) {
    throw new Error("Doctor can only manage their own appointments.");
  }
  if (actor.role === "PATIENT" && appointment.patientUserId !== actor.userId) {
    throw new Error("Patient can only manage their own appointments.");
  }
}

export function updateAppointment(
  id: string,
  actor: { userId: string; role: Role },
  updates: {
    status?: AppointmentStatus;
    reason?: string;
    cancellationReason?: string | null;
  },
) {
  const db = getDb();
  const existing = getAppointmentRow(id);
  if (!existing) return null;
  assertAppointmentAccess(existing, actor);

  const nextStatus = updates.status ?? existing.status;
  const updatedAt = nowIso();
  const cancellationReason = nextStatus === "cancelled"
    ? updates.cancellationReason ?? existing.cancellationReason ?? updates.reason ?? null
    : existing.cancellationReason;
  const confirmedAt = nextStatus === "confirmed" && !existing.confirmedAt ? updatedAt : existing.confirmedAt;
  const completedAt = nextStatus === "completed" && !existing.completedAt ? updatedAt : existing.completedAt;
  const cancelledAt = nextStatus === "cancelled" && !existing.cancelledAt ? updatedAt : existing.cancelledAt;

  db.prepare(
    `UPDATE appointments
     SET status = ?, reason = ?, cancellation_reason = ?, confirmed_at = ?, completed_at = ?, cancelled_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    nextStatus,
    updates.reason ?? existing.reason,
    cancellationReason,
    confirmedAt,
    completedAt,
    cancelledAt,
    updatedAt,
    id,
  );

  if (nextStatus !== existing.status) {
    createStatusHistory({
      appointmentId: id,
      previousStatus: existing.status,
      nextStatus,
      changedByUserId: actor.userId,
      changeReason: updates.reason ?? updates.cancellationReason ?? null,
    });
  }

  if (existing.patientRecordId && ["booked", "confirmed", "completed", "revisit_suggested"].includes(nextStatus)) {
    assignDoctorToPatient({
      doctorId: existing.doctorId,
      patientRecordId: existing.patientRecordId,
      patientUserId: existing.patientUserId,
      source: `appointment_${nextStatus}`,
    });
  }

  if (nextStatus === "completed") {
    createVisitFromAppointment({
      ...existing,
      status: nextStatus,
      reason: updates.reason ?? existing.reason,
      cancellationReason,
      confirmedAt,
      completedAt,
      cancelledAt,
    });
  }

  exportDoctorAppointmentsCsv(existing.doctorId);
  return getAppointmentRow(id);
}

export function rescheduleAppointment(
  id: string,
  actor: { userId: string; role: Role },
  input: { slotStart: string; slotEnd: string; reason: string },
) {
  const existing = getAppointmentRow(id);
  if (!existing) return null;
  assertAppointmentAccess(existing, actor);

  const newAppointmentId = createAppointment({
    doctorId: existing.doctorId,
    patientUserId: existing.patientUserId,
    patientRecordId: existing.patientRecordId ?? undefined,
    slotStart: input.slotStart,
    slotEnd: input.slotEnd,
    reason: input.reason,
    createdByRole: actor.role,
    status: "booked",
    rescheduledFromAppointmentId: existing.id,
    revisitFromVisitId: existing.revisitFromVisitId,
  });

  const db = getDb();
  const now = nowIso();
  db.prepare(
    `UPDATE appointments
     SET status = 'rescheduled', rescheduled_to_appointment_id = ?, updated_at = ?
     WHERE id = ?`,
  ).run(newAppointmentId, now, id);
  createStatusHistory({
    appointmentId: id,
    previousStatus: existing.status,
    nextStatus: "rescheduled",
    changedByUserId: actor.userId,
    changeReason: input.reason,
  });
  exportDoctorAppointmentsCsv(existing.doctorId);
  return {
    previous: getAppointmentRow(id),
    next: getAppointmentRow(newAppointmentId),
  };
}

export function deleteAppointment(id: string, actor?: { userId: string; role: Role }) {
  const db = getDb();
  const existing = getAppointmentRow(id);
  if (!existing) return false;
  if (actor) {
    assertAppointmentAccess(existing, actor);
  }
  const result = db.prepare("DELETE FROM appointments WHERE id = ?").run(id);
  exportDoctorAppointmentsCsv(existing.doctorId);
  return result.changes > 0;
}

export async function listDoctorAppointments(doctorId: string): Promise<AppointmentView[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, doctor_id, patient_user_id, patient_record_id, slot_start, slot_end, status, reason, created_by_role, created_at, updated_at,
              cancellation_reason, rescheduled_from_appointment_id, rescheduled_to_appointment_id, revisit_from_visit_id,
              confirmed_at, completed_at, cancelled_at, visit_id
       FROM appointments
       WHERE doctor_id = ?
       ORDER BY slot_start ASC`,
    )
    .all(doctorId) as Array<{
      id: string;
      doctor_id: string;
      patient_user_id: string | null;
      patient_record_id: string | null;
      slot_start: string;
      slot_end: string;
      status: AppointmentStatus;
      reason: string;
      created_by_role: Role;
      created_at: string;
      updated_at: string;
      cancellation_reason: string | null;
      rescheduled_from_appointment_id: string | null;
      rescheduled_to_appointment_id: string | null;
      revisit_from_visit_id: string | null;
      confirmed_at: string | null;
      completed_at: string | null;
      cancelled_at: string | null;
      visit_id: string | null;
    }>;
  return enrichAppointments(rows.map(mapAppointment));
}

export async function listPatientAppointments(patientUserId: string): Promise<AppointmentView[]> {
  const link = await getPatientRecordLink(patientUserId);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, doctor_id, patient_user_id, patient_record_id, slot_start, slot_end, status, reason, created_by_role, created_at, updated_at,
              cancellation_reason, rescheduled_from_appointment_id, rescheduled_to_appointment_id, revisit_from_visit_id,
              confirmed_at, completed_at, cancelled_at, visit_id
       FROM appointments
       WHERE patient_user_id = ? OR patient_record_id = ?
       ORDER BY slot_start ASC`,
    )
    .all(patientUserId, link?.patientRecordId || "") as Array<{
      id: string;
      doctor_id: string;
      patient_user_id: string | null;
      patient_record_id: string | null;
      slot_start: string;
      slot_end: string;
      status: AppointmentStatus;
      reason: string;
      created_by_role: Role;
      created_at: string;
      updated_at: string;
      cancellation_reason: string | null;
      rescheduled_from_appointment_id: string | null;
      rescheduled_to_appointment_id: string | null;
      revisit_from_visit_id: string | null;
      confirmed_at: string | null;
      completed_at: string | null;
      cancelled_at: string | null;
      visit_id: string | null;
    }>;
  return enrichAppointments(rows.map(mapAppointment));
}

export async function createPatientRequestedAppointment(
  patientUserId: string,
  input: {
    doctorId: string;
    slotStart: string;
    slotEnd: string;
    reason: string;
  },
) {
  const link = await getOrCreatePatientRecordLink(patientUserId);
  assignDoctorToPatient({
    doctorId: input.doctorId,
    patientRecordId: link.patientRecordId,
    patientUserId,
    source: "patient_request",
  });
  return createAppointment({
    doctorId: input.doctorId,
    patientUserId,
    patientRecordId: link.patientRecordId,
    slotStart: input.slotStart,
    slotEnd: input.slotEnd,
    reason: input.reason,
    createdByRole: "PATIENT",
    status: "requested",
  });
}

export async function createDoctorBookedAppointment(
  doctorId: string,
  input: {
    patientRecordId: string;
    slotStart: string;
    slotEnd: string;
    reason: string;
    revisitFromVisitId?: string | null;
  },
) {
  const linkedUsers = await getUserIdsForPatientRecord(input.patientRecordId);
  assignDoctorToPatient({
    doctorId,
    patientRecordId: input.patientRecordId,
    patientUserId: linkedUsers[0] || null,
    source: input.revisitFromVisitId ? "doctor_revisit" : "doctor_booking",
  });
  return createAppointment({
    doctorId,
    patientUserId: linkedUsers[0] || null,
    patientRecordId: input.patientRecordId,
    slotStart: input.slotStart,
    slotEnd: input.slotEnd,
    reason: input.reason,
    createdByRole: "DOCTOR",
    status: "booked",
    revisitFromVisitId: input.revisitFromVisitId ?? null,
  });
}

export async function createDoctorSuggestedRevisit(
  doctorId: string,
  input: {
    patientRecordId: string;
    slotStart: string;
    slotEnd: string;
    reason: string;
    revisitFromVisitId: string;
  },
) {
  requireDoctorPatientAccess(doctorId, input.patientRecordId);
  return createDoctorBookedAppointment(doctorId, {
    patientRecordId: input.patientRecordId,
    slotStart: input.slotStart,
    slotEnd: input.slotEnd,
    reason: input.reason,
    revisitFromVisitId: input.revisitFromVisitId,
  });
}

export function listVisitsForDoctorPatient(doctorId: string, patientRecordId: string) {
  requireDoctorPatientAccess(doctorId, patientRecordId);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, doctor_id, patient_user_id, patient_record_id, appointment_id, reason, status, started_at, ended_at, created_at, updated_at
       FROM visits
       WHERE doctor_id = ? AND patient_record_id = ?
       ORDER BY started_at DESC`,
    )
    .all(doctorId, patientRecordId) as Array<{
      id: string;
      doctor_id: string;
      patient_user_id: string | null;
      patient_record_id: string;
      appointment_id: string | null;
      reason: string | null;
      status: string;
      started_at: string;
      ended_at: string | null;
      created_at: string;
      updated_at: string;
    }>;
  return rows.map(mapVisit);
}

export function listVisitEvents(visitId: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, visit_id, event_type, title, description, event_at, created_at
       FROM visit_events
       WHERE visit_id = ?
       ORDER BY event_at ASC`,
    )
    .all(visitId) as Array<{
      id: string;
      visit_id: string;
      event_type: string;
      title: string;
      description: string | null;
      event_at: string;
      created_at: string;
    }>;
  return rows.map((row) => ({
    id: row.id,
    visitId: row.visit_id,
    eventType: row.event_type,
    title: row.title,
    description: row.description,
    eventAt: row.event_at,
    createdAt: row.created_at,
  })) as VisitEventRow[];
}
