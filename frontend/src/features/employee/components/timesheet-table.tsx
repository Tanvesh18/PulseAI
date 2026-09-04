import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { formatHours, getTimesheetTotal } from "../data/mock-employee";
import type { TimesheetPeriod } from "../types";
import { TimesheetStatusBadge } from "./timesheet-status-badge";
import styles from "../employee.module.css";

export function TimesheetTable({
  caption,
  compact = false,
  timesheets,
}: {
  caption: string;
  compact?: boolean;
  timesheets: TimesheetPeriod[];
}) {
  const formatDateTime = (value?: string | null) => {
    if (!value) return "Not submitted";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(date);
  };
  return (
    <div className={styles.tableFrame}>
      <table className={styles.dataTable}>
        <caption className={styles.visuallyHidden}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Status</th>
            <th className={styles.numericColumn} scope="col">
              Hours
            </th>
            {!compact ? <th scope="col">Submitted</th> : null}
            {!compact ? <th scope="col">Approval</th> : null}
            <th className={styles.actionColumn} scope="col">
              <span className={styles.visuallyHidden}>Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {timesheets.map((timesheet) => (
            <tr key={timesheet.id}>
              <th scope="row">
                <span className={styles.periodCell}>{timesheet.label}</span>
              </th>
              <td>
                <TimesheetStatusBadge status={timesheet.status} />
              </td>
              <td className={styles.numericColumn}>
                <span className={styles.dataValue}>
                  {formatHours(getTimesheetTotal(timesheet))}
                </span>
              </td>
              {!compact ? (
                <td className={styles.metadataCell}>
                  {formatDateTime(timesheet.submittedAt)}
                </td>
              ) : null}
              {!compact ? (
                <td className={styles.metadataCell}>
                  {timesheet.status === "approved" ? (
                    <>
                      <span>{timesheet.approvedBy}</span>
                      <small>{formatDateTime(timesheet.approvedAt)}</small>
                    </>
                  ) : timesheet.status === "rejected" ? (
                    <>
                      <span>Returned by {timesheet.approvedBy}</span>
                      <small>Review the timesheet detail</small>
                    </>
                  ) : (
                    "Awaiting review"
                  )}
                </td>
              ) : null}
              <td className={styles.actionColumn}>
                <Link
                  className={buttonClassName("ghost", "small")}
                  href={`/employee/timesheets/${timesheet.id}`}
                  aria-label={`View timesheet details for ${timesheet.label}`}
                >
                  View details
                  <ArrowUpRight aria-hidden="true" size={15} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
