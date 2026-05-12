import { listPatientMemos } from "./doctorMemos";
import { getDoctorPatientTimeline, getDoctorPatientReportWorkspace } from "./doctorWorkspace";
import { listPatientReviews } from "./patientReviews";
import { listDoctorAppointments } from "./scheduling";
import { assignDoctorToPatient } from "./clinicalOwnership";

export async function getDoctorPatientBundle(doctorId: string, patientId: string) {
  assignDoctorToPatient({
    doctorId,
    patientRecordId: patientId,
    source: "chart_open",
    notes: "Assigned automatically when the doctor opened the patient chart from the directory.",
  });

  const [timeline, reports, reviews, memos, allAppointments] = await Promise.all([
    getDoctorPatientTimeline(patientId, doctorId),
    getDoctorPatientReportWorkspace(patientId),
    Promise.resolve(listPatientReviews(doctorId, patientId)),
    Promise.resolve(listPatientMemos(doctorId, patientId)),
    listDoctorAppointments(doctorId),
  ]);

  if (!timeline) return null;

  const appointments = allAppointments.filter((appointment) => appointment.patientRecordId === patientId);

  return {
    patient: timeline.patient,
    timeline,
    reports,
    reviews,
    memos,
    appointments,
  };
}
