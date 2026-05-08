import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { mockReport } from "@/lib/reports/buildReport";

export default async function DashboardPage() {
  return <DashboardClient initialReport={await mockReport({ allowLlmAuditors: false })} />;
}
