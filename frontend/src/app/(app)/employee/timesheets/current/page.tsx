import type { Metadata } from "next";
import { CurrentTimesheetScreen } from "@/features/employee/current-timesheet-screen";

export const metadata: Metadata = {
  title: "My timesheet",
};

export default function CurrentTimesheetPage() {
  return <CurrentTimesheetScreen />;
}
