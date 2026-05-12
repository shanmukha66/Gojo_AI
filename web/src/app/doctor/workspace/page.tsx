import { redirect } from "next/navigation";

export default async function DoctorWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ patient?: string }>;
}) {
  const { patient } = await searchParams;
  if (patient && patient !== "undefined") {
    redirect(`/doctor/patients/${encodeURIComponent(patient)}/overview`);
  }
  redirect("/doctor/patients");
}
