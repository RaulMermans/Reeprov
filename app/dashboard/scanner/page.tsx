import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { mockReport } from "@/lib/reports/buildReport";

export default async function ScannerPage() {
  const initialReport = await mockReport();
  return <DashboardClient initialReport={initialReport} />;
}
