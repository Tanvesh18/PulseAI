import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import {
  currentTimesheet,
  formatHours,
  getTimesheetTotal,
  timesheetHistory,
} from "@/features/employee/data/mock-employee";
import { PageHeader } from "@/features/employee/components/page-header";
import { TimesheetStatusBadge } from "@/features/employee/components/timesheet-status-badge";
import { TimesheetTable } from "@/features/employee/components/timesheet-table";
import styles from "@/features/employee/employee.module.css";

export const metadata: Metadata = {
  title: "Employee overview",
};

export default function EmployeeDashboardPage() {
  const totalHours = getTimesheetTotal(currentTimesheet);
  const remainingHours = Math.max(
    currentTimesheet.expectedHours - totalHours,
    0,
  );
  const dailyTotals = currentTimesheet.days.map((day) => ({
    ...day,
    hours: currentTimesheet.entries.reduce(
      (sum, entry) => sum + entry.hours[day.day],
      0,
    ),
  }));

  return (
    <div className={styles.pageStack}>
      <PageHeader
        title="Welcome back, Avery"
        description="Your current week is still in draft. Review the items that need attention, then submit when the record is accurate."
        meta={<Badge tone="secondary">Demo data</Badge>}
      />

      <section
        className={styles.statusRegister}
        aria-labelledby="current-week-title"
      >
        <div className={styles.statusPrimary}>
          <div>
            <TimesheetStatusBadge status={currentTimesheet.status} />
            <h2 id="current-week-title">Current timesheet</h2>
            <p>{currentTimesheet.label} · Not submitted</p>
          </div>
          <Link
            className={buttonClassName("primary", "default")}
            href="/employee/timesheets/current"
          >
            Open timesheet
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
        </div>

        <dl className={styles.statusMetrics}>
          <div>
            <dt>Worked</dt>
            <dd>
              {formatHours(totalHours)} h<small>Recorded this period</small>
            </dd>
          </div>
          <div>
            <dt>Expected</dt>
            <dd>
              {formatHours(currentTimesheet.expectedHours)} h
              <small>Demo period expectation</small>
            </dd>
          </div>
          <div>
            <dt>Remaining</dt>
            <dd>
              {formatHours(remainingHours)} h
              <small>Before expected total</small>
            </dd>
          </div>
        </dl>
      </section>

      <div className={styles.dashboardGrid}>
        <section
          className={styles.sectionBlock}
          aria-labelledby="attention-title"
        >
          <div className={styles.sectionHeader}>
            <h2 id="attention-title">Needs attention</h2>
          </div>
          <div className={styles.alertList}>
            <Alert title="1 hour remains unrecorded" tone="warning">
              The current demo period contains 39 of 40 expected hours. Review
              the week before submitting.
            </Alert>
            <Alert title="Potential duplicate on Wednesday" tone="warning">
              Client portal · Implementation appears twice on Aug 26. Compare
              both entries before submission.
            </Alert>
          </div>
        </section>

        <section
          className={styles.sectionBlock}
          aria-labelledby="cadence-title"
        >
          <div className={styles.sectionHeader}>
            <h2 id="cadence-title">Week at a glance</h2>
          </div>
          <div className={styles.cadenceStrip}>
            {dailyTotals.map((day) => (
              <div
                className={`${styles.cadenceDay} ${
                  day.day === "wed"
                    ? styles.cadenceDayAttention
                    : day.hours > 0
                      ? styles.cadenceDayRecorded
                      : ""
                }`}
                key={day.day}
              >
                <span>{day.shortLabel}</span>
                <strong>{formatHours(day.hours)} h</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className={styles.sectionBlock} aria-labelledby="recent-title">
        <div className={styles.sectionHeader}>
          <h2 id="recent-title">Recent timesheets</h2>
          <Link href="/employee/timesheets/history">View all history</Link>
        </div>
        <TimesheetTable
          caption="Recent employee timesheets"
          compact
          timesheets={timesheetHistory.slice(0, 3)}
        />
      </section>

      <Alert
        title="Your employee scope"
        tone="info"
        action={
          <Link
            className={buttonClassName("secondary", "small")}
            href="/employee/timesheets/current"
          >
            <CalendarDays aria-hidden="true" size={15} />
            Review current week
          </Link>
        }
      >
        This demo workspace shows only Avery Rao’s timesheets and employee-level
        information.
      </Alert>
    </div>
  );
}
