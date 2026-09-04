"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import {
  getCurrentTimesheet,
  getEmployeeProfile,
  isEmployeeAccessError,
  listTimesheets,
} from "../data/employee-api";
import {
  currentTimesheet as fallbackCurrent,
  employeeProfile as fallbackProfile,
  formatHours,
  getTimesheetTotal,
  timesheetHistory as fallbackHistory,
} from "../data/mock-employee";
import type { EmployeeProfile, TimesheetPeriod } from "../types";
import styles from "../employee.module.css";
import { PageHeader } from "./page-header";
import { TimesheetStatusBadge } from "./timesheet-status-badge";
import { TimesheetTable } from "./timesheet-table";

export function EmployeeOverviewScreen() {
  const [current, setCurrent] = useState<TimesheetPeriod>(fallbackCurrent);
  const [history, setHistory] = useState<TimesheetPeriod[]>(fallbackHistory);
  const [profile, setProfile] = useState<EmployeeProfile>(fallbackProfile);
  const [connected, setConnected] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getCurrentTimesheet(), listTimesheets(), getEmployeeProfile()])
      .then(([currentResult, timesheets, profileResult]) => {
        if (!active) return;
        setCurrent(currentResult);
        setHistory(timesheets.filter((item) => item.id !== currentResult.id));
        setProfile(profileResult);
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
          setRefreshError(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const totalHours = getTimesheetTotal(current);
  const remainingHours = Math.max(current.expectedHours - totalHours, 0);
  const dailyTotals = current.days.map((day) => ({
    ...day,
    hours: current.entries.reduce(
      (sum, entry) => sum + entry.hours[day.day],
      0,
    ),
  }));

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
        title={`Welcome back, ${profile.name.split(" ")[0]}`}
        description="Review the current period, resolve anything that needs attention, and submit when the record is accurate."
        meta={
          <Badge tone={connected ? "approved" : "secondary"}>
            {connected ? "Live employee data" : "Offline demo data"}
          </Badge>
        }
      />

      {refreshError ? (
        <Alert title="Live data is temporarily unavailable" tone="warning">
          Showing the bundled employee example. Saving remains unavailable until
          the service reconnects.
        </Alert>
      ) : null}

      <section
        className={styles.statusRegister}
        aria-labelledby="current-week-title"
      >
        <div className={styles.statusPrimary}>
          <div>
            <TimesheetStatusBadge status={current.status} />
            <h2 id="current-week-title">Current timesheet</h2>
            <p>
              {current.label} ·{" "}
              {current.status === "draft" ? "Not submitted" : current.status}
            </p>
          </div>
          <Link
            className={buttonClassName("primary", "default")}
            href="/employee/timesheets/current"
          >
            Open timesheet <ArrowRight aria-hidden="true" size={17} />
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
              {formatHours(current.expectedHours)} h
              <small>Weekly expectation</small>
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
            {current.issues.length ? (
              current.issues.map((issue) => (
                <Alert
                  key={issue.id}
                  title={issue.title}
                  tone={issue.type === "unusual" ? "anomaly" : "warning"}
                >
                  {issue.message}
                </Alert>
              ))
            ) : (
              <Alert title="No current warnings" tone="success">
                The recorded week has no unresolved deterministic warnings.
              </Alert>
            )}
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
                className={`${styles.cadenceDay} ${day.hours > 0 ? styles.cadenceDayRecorded : ""}`}
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
        {history.length ? (
          <TimesheetTable
            caption="Recent employee timesheets"
            compact
            timesheets={history.slice(0, 3)}
          />
        ) : (
          <Alert title="No previous periods" tone="info">
            Completed and submitted periods will appear here.
          </Alert>
        )}
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
        This workspace is restricted to {profile.name}’s timesheets and
        employee-level information.
      </Alert>
    </div>
  );
}
