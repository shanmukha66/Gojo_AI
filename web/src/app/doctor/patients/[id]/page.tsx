import { redirect } from "next/navigation";

export default async function DoctorPatientRootPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/doctor/patients/${encodeURIComponent(id)}/overview`);
}
