export type PortalNavItem = {
  href: string;
  label: string;
  description?: string;
};

export const doctorNav: PortalNavItem[] = [
  { href: "/doctor", label: "Overview", description: "Main summary" },
  { href: "/doctor/patients", label: "Patients", description: "Patient charts" },
  { href: "/doctor/copilot", label: "Copilot", description: "Second opinion" },
  { href: "/doctor/evidence", label: "Evidence", description: "RAG search" },
  { href: "/doctor/ground-truth", label: "Ground Truth", description: "Trusted sources" },
  { href: "/doctor/memos", label: "Memos", description: "Private notes" },
  { href: "/doctor/schedule", label: "Schedule", description: "Calendar and visits" },
  { href: "/doctor/metrics", label: "Predictions", description: "Models and explainability" },
  { href: "/doctor/ai-metrics", label: "AI Metrics", description: "MiniMax and RL" },
  { href: "/doctor/settings", label: "Settings", description: "Preferences" },
];

export const patientNav: PortalNavItem[] = [
  { href: "/patient", label: "Overview", description: "Main summary" },
  { href: "/patient/assistant", label: "Assistant", description: "Questions and guidance" },
  { href: "/patient/reports", label: "Reports", description: "Uploads and extracted data" },
  { href: "/patient/appointments", label: "Appointments", description: "Booking and tracking" },
  { href: "/patient/settings", label: "Settings", description: "Preferences" },
];
