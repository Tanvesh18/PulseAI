"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getCurrentTimesheet,
  saveTimesheet,
  submitTimesheet,
} from "../data/employee-api";
import type { TimesheetEntry, TimesheetPeriod } from "../types";
import styles from "../employee.module.css";
import { TimesheetEditor } from "./timesheet-editor";

export function CurrentTimesheetScreen() {
  const [timesheet, setTimesheet] = useState<TimesheetPeriod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTimesheet(await getCurrentTimesheet());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The timesheet could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getCurrentTimesheet()
      .then((result) => {
        if (active) setTimesheet(result);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "The timesheet could not be loaded.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className={styles.pageStack} aria-busy="true" aria-live="polite">
        <Alert title="Loading your timesheet" tone="info">
          Checking the current period and your active project assignments.
        </Alert>
      </div>
    );
  }

  if (!timesheet || error) {
    return (
      <div className={styles.pageStack}>
        <Alert
          title="Your timesheet could not be loaded"
          tone="error"
          action={<Button onClick={() => void load()}>Try again</Button>}
        >
          {error ?? "The service returned no current timesheet."} No entries
          were changed.
        </Alert>
      </div>
    );
  }

  async function save(entries: TimesheetEntry[], expectedVersion: number) {
    const updated = await saveTimesheet(timesheet!, entries, expectedVersion);
    setTimesheet(updated);
    return updated;
  }

  async function submit(entries: TimesheetEntry[], expectedVersion: number) {
    const updated = await submitTimesheet(timesheet!, entries, expectedVersion);
    setTimesheet(updated);
    return updated;
  }

  return (
    <TimesheetEditor
      key={timesheet.id}
      timesheet={timesheet}
      onSave={save}
      onSubmit={submit}
    />
  );
}
