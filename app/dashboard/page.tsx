import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { mockReport } from "@/lib/reports/buildReport";

export default function DashboardPage() {
  return <DashboardClient initialReport={mockReport()} />;
}
