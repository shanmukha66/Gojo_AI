const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = new Database(path.join(process.cwd(), 'data', 'app.db'));
const doctor = db.prepare("SELECT id, name FROM users WHERE role = 'DOCTOR' ORDER BY CASE WHEN id = 'demo-doctor' THEN 0 ELSE 1 END LIMIT 1").get();
if (!doctor) throw new Error('No doctor user found');

const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const seedNow = new Date(2026, 4, 6, 9, 0, 0, 0);
const rangeStart = new Date(2026, 4, 1, 0, 0, 0, 0);
const rangeEnd = new Date(2026, 6, 1, 0, 0, 0, 0);

const firstNames = ['Aarav','Anika','Michael','Grace','Robert','Sofia','Daniel','Meera','James','Priya','Ethan','Leah','Noah','Isha','Maya','Rohan','Ava','Lucas','Mina','Omar','Nina','Victor','Elena','Samir','Hannah','Liam','Zara','Arjun','Emily','Kiran','Fatima','Jonah','Sara','Mateo','Chloe','Nikhil','Nora','Aiden','Riya','Thomas','Saanvi','Leo','Amara','Ibrahim','Layla','Chen','Yuki','Rafael','Mariam','Asha'];
const lastNames = ['Rao','Torres','Chen','Williams','Martinez','Patel','Nguyen','Johnson','Khan','Singh','Garcia','Brown','Kim','Ali','Miller','Davis','Wilson','Thomas','Moore','Anderson','Taylor','Clark','Lopez','Young','Walker','Hall','Allen','Wright','Scott','Green'];
const reasons = [
  'Diabetes follow-up and medication adherence review',
  'Blood pressure check and home readings review',
  'Post-discharge follow-up after shortness of breath episode',
  'Annual wellness visit with preventive screening review',
  'Lab result discussion: HbA1c, lipids, kidney function',
  'Chronic knee pain evaluation and imaging follow-up',
  'Thyroid monitoring and symptom review',
  'Anemia workup follow-up with ferritin and CBC review',
  'Asthma/COPD inhaler technique and symptom check',
  'Medication reconciliation after pharmacy change',
  'Chest discomfort follow-up after urgent care visit',
  'Telehealth review for rash and medication side effects',
  'Pre-operative clearance and risk review',
  'Post-procedure wound check',
  'Mental health follow-up and sleep concern review',
  'Headache pattern review and red-flag screening',
  'Back pain follow-up and physical therapy planning',
  'Kidney function monitoring after abnormal creatinine',
  'Pregnancy/postpartum lab follow-up',
  'Vaccination counseling and travel health review',
];
const tags = ['routine','follow-up','lab-review','urgent-care-followup','telehealth','chronic-care','new-symptom','post-discharge'];

function pad(value) { return String(value).padStart(2, '0'); }
function localDateKey(date) { return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; }
function isoLocal(year, monthIndex, day, hour, minute) { return new Date(year, monthIndex, day, hour, minute, 0, 0).toISOString(); }
function addMinutes(date, mins) { return new Date(date.getTime() + mins * 60000); }
function deterministic(index, mod) { return Math.abs(Math.sin(index * 999.31) * 100000 | 0) % mod; }
function choose(arr, index) { return arr[deterministic(index, arr.length)]; }

function ensurePatient(index) {
  const recordId = String(93000 + index);
  const userId = `schedule-patient-${recordId}`;
  const name = `${choose(firstNames, index)} ${choose(lastNames, index * 7 + 3)}`;
  const email = `schedule.patient.${recordId}@gojo.mock`;
  const timestamp = nowIso();
  db.prepare(`INSERT INTO users (id, name, email, password_hash, role, created_at)
              VALUES (?, ?, ?, 'mock-password', 'PATIENT', ?)
              ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email`).run(userId, name, email, timestamp);
  db.prepare(`INSERT INTO patient_record_links (user_id, patient_record_id, updated_at)
              VALUES (?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET patient_record_id = excluded.patient_record_id, updated_at = excluded.updated_at`).run(userId, recordId, timestamp);
  db.prepare(`INSERT INTO doctor_patient_assignments (id, doctor_id, patient_user_id, patient_record_id, source, assigned_at, active, notes)
              SELECT ?, ?, ?, ?, 'schedule_seed', ?, 1, 'Seeded realistic timetable patient'
              WHERE NOT EXISTS (SELECT 1 FROM doctor_patient_assignments WHERE doctor_id = ? AND patient_record_id = ? AND active = 1)`).run(uuid(), doctor.id, userId, recordId, timestamp, doctor.id, recordId);
  return { userId, recordId, name };
}

const patients = Array.from({ length: 90 }, (_, i) => ensurePatient(i + 1));

const existingIds = db.prepare(`SELECT id FROM appointments WHERE doctor_id = ? AND slot_start >= ? AND slot_start < ?`).all(doctor.id, rangeStart.toISOString(), rangeEnd.toISOString()).map(r => r.id);
const deleteTx = db.transaction((ids) => {
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  const visitIds = db.prepare(`SELECT id FROM visits WHERE appointment_id IN (${placeholders})`).all(...ids).map(r => r.id);
  if (visitIds.length) {
    db.prepare(`DELETE FROM visit_events WHERE visit_id IN (${visitIds.map(() => '?').join(',')})`).run(...visitIds);
  }
  db.prepare(`DELETE FROM visits WHERE appointment_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM appointment_status_history WHERE appointment_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM appointments WHERE id IN (${placeholders})`).run(...ids);
});
deleteTx(existingIds);

const availabilityTx = db.transaction(() => {
  db.prepare('DELETE FROM doctor_availability WHERE doctor_id = ?').run(doctor.id);
  const insert = db.prepare(`INSERT INTO doctor_availability (id, doctor_id, weekday, start_time, end_time, slot_minutes, active, created_at, updated_at)
                             VALUES (?, ?, ?, ?, ?, 30, 1, ?, ?)`);
  const ts = nowIso();
  for (let weekday = 1; weekday <= 5; weekday++) {
    insert.run(uuid(), doctor.id, weekday, '08:30', '12:30', ts, ts);
    insert.run(uuid(), doctor.id, weekday, '13:30', '17:30', ts, ts);
  }
  insert.run(uuid(), doctor.id, 6, '09:00', '13:00', ts, ts);
});
availabilityTx();

function daySlots(date, dayIndex) {
  const weekday = date.getDay();
  if (weekday === 0) {
    if (deterministic(dayIndex, 4) !== 0) return [];
    return [[10, 0], [10, 45], [11, 30]].filter((_, i) => deterministic(dayIndex + i, 3) !== 0);
  }
  if (weekday === 6) {
    return [[9,0],[9,30],[10,0],[10,45],[11,15],[12,0]].filter((_, i) => deterministic(dayIndex + i * 2, 5) !== 0);
  }
  const base = [[8,30],[9,0],[9,30],[10,0],[10,45],[11,15],[11,45],[13,30],[14,0],[14,30],[15,0],[15,45],[16,15],[16,45],[17,15]];
  return base.filter((_, i) => {
    const gap = deterministic(dayIndex * 13 + i * 17, 10);
    return gap > 1; // leave natural gaps
  });
}

function statusFor(start, counter) {
  if (start < seedNow) return 'completed';
  const r = deterministic(counter, 10);
  if (r <= 1) return 'requested';
  if (r <= 5) return 'booked';
  return 'confirmed';
}

const insertAppointment = db.prepare(`INSERT INTO appointments
  (id, doctor_id, patient_user_id, patient_record_id, slot_start, slot_end, status, reason, created_by_role, created_at, updated_at,
   cancellation_reason, rescheduled_from_appointment_id, rescheduled_to_appointment_id, revisit_from_visit_id, confirmed_at, completed_at, cancelled_at, visit_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DOCTOR', ?, ?, NULL, NULL, NULL, NULL, ?, ?, NULL, ?)`);
const insertHistory = db.prepare(`INSERT INTO appointment_status_history (id, appointment_id, previous_status, next_status, changed_by_user_id, change_reason, created_at)
                                  VALUES (?, ?, ?, ?, ?, ?, ?)`);
const insertVisit = db.prepare(`INSERT INTO visits (id, doctor_id, patient_user_id, patient_record_id, appointment_id, reason, status, started_at, ended_at, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)`);
const insertVisitEvent = db.prepare(`INSERT INTO visit_events (id, visit_id, event_type, title, description, event_at, created_at)
                                     VALUES (?, ?, 'follow_up', 'Appointment completed', ?, ?, ?)`);
const updateVisitId = db.prepare(`UPDATE appointments SET visit_id = ? WHERE id = ?`);

let created = 0;
const seedTx = db.transaction(() => {
  for (let d = new Date(rangeStart), dayIndex = 1; d < rangeEnd; d.setDate(d.getDate() + 1), dayIndex++) {
    const slots = daySlots(d, dayIndex);
    slots.forEach(([hour, minute], slotIndex) => {
      created += 1;
      const patient = patients[deterministic(dayIndex * 31 + slotIndex * 11 + created, patients.length)];
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0, 0);
      const duration = deterministic(created, 5) === 0 ? 45 : 30;
      const end = addMinutes(start, duration);
      const status = statusFor(start, created);
      const reason = `${choose(reasons, created + dayIndex)} (${choose(tags, created * 3)})`;
      const id = uuid();
      const ts = nowIso();
      const completedAt = status === 'completed' ? end.toISOString() : null;
      const confirmedAt = status === 'confirmed' || status === 'completed' ? ts : null;
      let visitId = null;
      insertAppointment.run(id, doctor.id, patient.userId, patient.recordId, start.toISOString(), end.toISOString(), status, reason, ts, ts, confirmedAt, completedAt, visitId);
      insertHistory.run(uuid(), id, null, 'booked', doctor.id, 'Seeded realistic appointment', ts);
      if (status === 'confirmed') insertHistory.run(uuid(), id, 'booked', 'confirmed', doctor.id, 'Confirmed by clinic', ts);
      if (status === 'requested') insertHistory.run(uuid(), id, null, 'requested', patient.userId, 'Requested by patient portal', ts);
      if (status === 'completed') {
        insertHistory.run(uuid(), id, 'booked', 'confirmed', doctor.id, 'Confirmed by clinic', ts);
        insertHistory.run(uuid(), id, 'confirmed', 'completed', doctor.id, 'Visit completed', ts);
        visitId = uuid();
        insertVisit.run(visitId, doctor.id, patient.userId, patient.recordId, id, reason, start.toISOString(), end.toISOString(), ts, ts);
        insertVisitEvent.run(uuid(), visitId, reason, end.toISOString(), ts);
        updateVisitId.run(visitId, id);
      }
    });
  }
});
seedTx();

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function writeCsv(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!rows.length) return fs.writeFileSync(file, '', 'utf8');
  const headers = [...rows.reduce((set, row) => { Object.keys(row).forEach(k => set.add(k)); return set; }, new Set())];
  fs.writeFileSync(file, [headers.join(','), ...rows.map(row => headers.map(h => csvEscape(row[h])).join(','))].join('\n') + '\n', 'utf8');
}
const exportDir = path.join(process.cwd(), 'data', 'exports', `doctor_${doctor.id}`);
const appts = db.prepare(`SELECT id, doctor_id AS doctorId, patient_user_id AS patientUserId, patient_record_id AS patientRecordId, slot_start AS slotStart, slot_end AS slotEnd, status, reason, created_by_role AS createdByRole, created_at AS createdAt, updated_at AS updatedAt FROM appointments WHERE doctor_id = ? ORDER BY slot_start ASC`).all(doctor.id);
const history = db.prepare(`SELECT h.id, h.appointment_id AS appointmentId, h.previous_status AS previousStatus, h.next_status AS nextStatus, h.changed_by_user_id AS changedByUserId, h.change_reason AS changeReason, h.created_at AS createdAt FROM appointment_status_history h INNER JOIN appointments a ON a.id = h.appointment_id WHERE a.doctor_id = ? ORDER BY h.created_at ASC`).all(doctor.id);
const availability = db.prepare(`SELECT id, doctor_id AS doctorId, weekday, start_time AS startTime, end_time AS endTime, slot_minutes AS slotMinutes, active, created_at AS createdAt, updated_at AS updatedAt FROM doctor_availability WHERE doctor_id = ? ORDER BY weekday, start_time`).all(doctor.id);
writeCsv(path.join(exportDir, 'appointments.csv'), appts);
writeCsv(path.join(exportDir, 'appointment_history.csv'), history);
writeCsv(path.join(exportDir, 'availability.csv'), availability);

console.log(JSON.stringify({ doctor: doctor.id, doctorName: doctor.name, range: `${localDateKey(rangeStart)} to ${localDateKey(new Date(rangeEnd.getTime()-86400000))}`, created, patients: patients.length, exportDir }, null, 2));
