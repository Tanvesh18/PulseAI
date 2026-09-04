"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getTimesheet,
  isEmployeeAccessError,
  saveTimesheet,
  submitTimesheet,
} from "../data/employee-api";
import { getTimesheetById } from "../data/mock-employee";
import type { TimesheetPeriod } from "../types";
import styles from "../employee.module.css";
import { TimesheetEditor } from "./timesheet-editor";

export function HistoricalTimesheetScreen({ periodId }: { periodId: string }) {
  const [timesheet, setTimesheet] = useState<TimesheetPeriod | null>(
    () => getTimesheetById(periodId) ?? null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getTimesheet(periodId)
      .then(setTimesheet)
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "The timesheet could not be loaded.",
        ),
      )
      .finally(() => setLoading(false));
  }, [periodId]);

  useEffect(() => {
    let active = true;
    getTimesheet(periodId)
      .then((result) => {
        if (active) setTimesheet(result);
      })
      .catch((reason: unknown) => {
        if (active) {
          if (isEmployeeAccessError(reason)) setTimesheet(null);
          setError(
            reason instanceof Error
              ? reason.message
              : "The timesheet could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [periodId]);

  if (loading && !timesheet) {
    return (
      <div className={styles.pageStack} aria-busy="true">
        <Alert title="Loading timesheet" tone="info">
          Retrieving the selected period.
        </Alert>
      </div>
    );
  }
  if (error && !timesheet) {
    return (
      <div className={styles.pageStack}>
        <Alert
          title="Timesheet unavailable"
          tone="error"
          action={<Button onClick={load}>Try again</Button>}
        >
          {error}
        </Alert>
      </div>
    );
  }
  if (!timesheet) return null;

  return (
    <div className={styles.pageStack}>
      {error ? (
        <Alert title="Live detail could not be refreshed" tone="warning">
          Showing the bundled copy of this period.
        </Alert>
      ) : null}
      <TimesheetEditor
        readOnly={timesheet.status !== "rejected"}
        timesheet={timesheet}
        onSave={async (entries, expectedVersion) => {
          const updated = await saveTimesheet(
            timesheet,
            entries,
            expectedVersion,
          );
          setTimesheet(updated);
          return updated;
        }}
        onSubmit={async (entries, expectedVersion) => {
          const updated = await submitTimesheet(
            timesheet,
            entries,
            expectedVersion,
          );
          setTimesheet(updated);
          return updated;
        }}
      />
    </div>
  );
}
