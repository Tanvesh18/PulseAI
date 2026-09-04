"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getCurrentTimesheet,
  isEmployeeAccessError,
  saveTimesheet,
  submitTimesheet,
} from "../data/employee-api";
import { currentTimesheet as staticCurrentTimesheet } from "../data/mock-employee";
import type { TimesheetEntry, TimesheetPeriod } from "../types";
import styles from "../employee.module.css";
import { TimesheetEditor } from "./timesheet-editor";

export function CurrentTimesheetScreen() {
  const [timesheet, setTimesheet] = useState<TimesheetPeriod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingStaticData, setUsingStaticData] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTimesheet(await getCurrentTimesheet());
      setUsingStaticData(false);
    } catch (reason) {
      if (isEmployeeAccessError(reason)) {
        setTimesheet(null);
        setError(reason.message);
      } else {
        setTimesheet(structuredClone(staticCurrentTimesheet));
        setUsingStaticData(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getCurrentTimesheet()
      .then((result) => {
        if (active) {
          setTimesheet(result);
          setUsingStaticData(false);
        }
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (isEmployeeAccessError(reason)) {
          setTimesheet(null);
          setError(
            reason instanceof Error
              ? reason.message
              : "Employee access is required.",
          );
        } else {
          setTimesheet(structuredClone(staticCurrentTimesheet));
          setUsingStaticData(true);
        }
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
      {...(usingStaticData ? {} : { onSave: save, onSubmit: submit })}
    />
  );
}
