"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { isEmployeeAccessError, listTimesheets } from "../data/employee-api";
import {
  formatHours,
  getTimesheetTotal,
  timesheetHistory as fallbackHistory,
} from "../data/mock-employee";
import type { TimesheetPeriod } from "../types";
import styles from "../employee.module.css";
import { PageHeader } from "./page-header";
import { TimesheetTable } from "./timesheet-table";

export function TimesheetHistoryScreen() {
  const [timesheets, setTimesheets] =
    useState<TimesheetPeriod[]>(fallbackHistory);
  const [connected, setConnected] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listTimesheets()
      .then((result) => {
        if (!active) return;
        setTimesheets(result);
        setConnected(true);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (isEmployeeAccessError(reason)) {
          setAccessError(
            reason instanceof Error
              ? reason.message
              : "Employee access is required.",
          );
        } else {
          setLoadFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const approved = timesheets.filter(
    (timesheet) => timesheet.status === "approved",
  );
  const approvedHours = approved.reduce(
    (sum, timesheet) => sum + getTimesheetTotal(timesheet),
    0,
  );

  if (accessError) {
    return (
      <div className={styles.pageStack}>
        <Alert title="Employee access required" tone="error">
          {accessError} Sign in through your organization’s identity service,
          then reload this page.
        </Alert>
      </div>
    );
  }

  return (
    <div className={styles.pageStack}>
      <PageHeader
        title="Timesheet history"
        description="Inspect previous periods, submission records, and approval information in your employee scope."
        meta={
          <Badge tone={connected ? "approved" : "secondary"}>
            {connected ? "Live employee data" : "Offline demo data"}
          </Badge>
        }
      />
      {loadFailed ? (
        <Alert title="History could not be refreshed" tone="warning">
          Showing the bundled example until the service is available.
        </Alert>
      ) : null}
      <dl className={styles.historySummary}>
        <div>
          <dt>Periods shown</dt>
          <dd>{timesheets.length}</dd>
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
          <h2 id="history-table-title">All periods</h2>
        </div>
        {timesheets.length ? (
          <TimesheetTable
            caption="Employee timesheet history"
            timesheets={timesheets}
          />
        ) : (
          <Alert title="No timesheet history" tone="info">
            Submitted periods will appear here.
          </Alert>
        )}
      </section>
    </div>
  );
}
