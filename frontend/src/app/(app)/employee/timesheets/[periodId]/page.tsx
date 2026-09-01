import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TimesheetEditor } from "@/features/employee/components/timesheet-editor";
import {
  getTimesheetById,
  timesheetHistory,
} from "@/features/employee/data/mock-employee";

export function generateStaticParams() {
  return timesheetHistory.map((timesheet) => ({ periodId: timesheet.id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/employee/timesheets/[periodId]">): Promise<Metadata> {
  const { periodId } = await params;
  const timesheet = getTimesheetById(periodId);

  return {
    title: timesheet ? `Timesheet ${timesheet.label}` : "Timesheet not found",
  };
}

export default async function HistoricalTimesheetPage({
  params,
}: PageProps<"/employee/timesheets/[periodId]">) {
  const { periodId } = await params;
  const timesheet = getTimesheetById(periodId);

  if (!timesheet || timesheet.id === "2026-08-24") {
    notFound();
  }

  return <TimesheetEditor readOnly timesheet={timesheet} />;
}
