import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/features/employee/components/page-header";
import { TimesheetTable } from "@/features/employee/components/timesheet-table";
import {
  formatHours,
  getTimesheetTotal,
  timesheetHistory,
} from "@/features/employee/data/mock-employee";
import styles from "@/features/employee/employee.module.css";

export const metadata: Metadata = {
  title: "Timesheet history",
};

export default function TimesheetHistoryPage() {
  const approved = timesheetHistory.filter(
    (timesheet) => timesheet.status === "approved",
  );
  const approvedHours = approved.reduce(
    (sum, timesheet) => sum + getTimesheetTotal(timesheet),
    0,
  );

  return (
    <div className={styles.pageStack}>
      <PageHeader
        title="Timesheet history"
        description="Inspect previous periods, submission records, and the approval information available in your employee scope."
        meta={<Badge tone="secondary">Demo data</Badge>}
      />

      <dl className={styles.historySummary}>
        <div>
          <dt>Periods shown</dt>
          <dd>{timesheetHistory.length}</dd>
        </div>
        <div>
          <dt>Approved periods</dt>
          <dd>{approved.length}</dd>
        </div>
        <div>
          <dt>Approved hours</dt>
          <dd>{formatHours(approvedHours)} h</dd>
        </div>
      </dl>

      <section
        className={styles.sectionBlock}
        aria-labelledby="history-table-title"
      >
        <div className={styles.sectionHeader}>
          <h2 id="history-table-title">Previous periods</h2>
        </div>
        <TimesheetTable
          caption="Employee timesheet history"
          timesheets={timesheetHistory}
        />
      </section>
    </div>
  );
}
