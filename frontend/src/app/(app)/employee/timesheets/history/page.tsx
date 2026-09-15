import type { Metadata } from "next";
import { TimesheetHistoryScreen } from "@/features/employee/timesheet-history-screen";

export const metadata: Metadata = {
  title: "Timesheet history",
};

export default function TimesheetHistoryPage() {
  return <TimesheetHistoryScreen />;
}
