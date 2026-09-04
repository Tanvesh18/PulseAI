import type { Metadata } from "next";
import { HistoricalTimesheetScreen } from "@/features/employee/components/historical-timesheet-screen";

export const metadata: Metadata = { title: "Timesheet detail" };

export default async function HistoricalTimesheetPage({
  params,
}: PageProps<"/employee/timesheets/[periodId]">) {
  const { periodId } = await params;
  return <HistoricalTimesheetScreen periodId={periodId} />;
}
