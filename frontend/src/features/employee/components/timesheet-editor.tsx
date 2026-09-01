"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  LockKeyhole,
  Save,
  Send,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatHours, getEntryTotal } from "../data/mock-employee";
import type {
  DayKey,
  TimesheetEntry,
  TimesheetPeriod,
  TimesheetStatus,
  ValidationIssue,
} from "../types";
import { PageHeader } from "./page-header";
import { TimesheetStatusBadge } from "./timesheet-status-badge";
import styles from "../employee.module.css";

type SaveState = "saved" | "saving" | "failed";

function getStatusCopy(status: TimesheetStatus): string {
  switch (status) {
    case "draft":
      return "Hours can be edited and saved before submission.";
    case "submitted":
    case "resubmitted":
      return "Submitted entries are read-only while manager review is pending.";
    case "approved":
      return "Approved entries are locked and included in downstream reporting.";
    case "rejected":
      return "Your manager returned this timesheet for correction. Update it and resubmit when ready.";
    case "reopened":
      return "This period was reopened and is awaiting an authorized workflow update.";
    case "void":
      return "This timesheet was voided and cannot be edited.";
  }
}

export function TimesheetEditor({
  onSave,
  onSubmit,
  readOnly = false,
  timesheet,
}: {
  onSave?: (
    entries: TimesheetEntry[],
    expectedVersion: number,
  ) => Promise<TimesheetPeriod>;
  onSubmit?: (
    entries: TimesheetEntry[],
    expectedVersion: number,
  ) => Promise<TimesheetPeriod>;
  readOnly?: boolean;
  timesheet: TimesheetPeriod;
}) {
  const [entries, setEntries] = useState<TimesheetEntry[]>(timesheet.entries);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [status, setStatus] = useState<TimesheetStatus>(timesheet.status);
  const [submittedThisSession, setSubmittedThisSession] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const version = useRef(timesheet.version ?? 1);
  const latestEntries = useRef(entries);
  const saveInFlight = useRef(false);
  const savePending = useRef(false);
  const isLocked = readOnly || (status !== "draft" && status !== "rejected");

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  const dailyTotals = useMemo(
    () =>
      Object.fromEntries(
        timesheet.days.map((day) => [
          day.day,
          entries.reduce((sum, entry) => sum + entry.hours[day.day], 0),
        ]),
      ) as Record<DayKey, number>,
    [entries, timesheet.days],
  );
  const weeklyTotal = useMemo(
    () => entries.reduce((sum, entry) => sum + getEntryTotal(entry), 0),
    [entries],
  );
  const varianceHours = timesheet.expectedHours - weeklyTotal;
  const liveIssues = useMemo<ValidationIssue[]>(() => {
    const issues: ValidationIssue[] = [];

    if (weeklyTotal < timesheet.expectedHours) {
      const missing = timesheet.expectedHours - weeklyTotal;
      issues.push({
        id: "missing-hours",
        type: "missing",
        title: `${formatHours(missing)} ${missing === 1 ? "hour remains" : "hours remain"} unrecorded`,
        message: `The current total is ${formatHours(weeklyTotal)} hours against the ${formatHours(timesheet.expectedHours)} hours expected for this demo period. Review the week before submitting.`,
      });
    }

    for (const day of timesheet.days) {
      const recordedByAssignment = new Map<string, TimesheetEntry[]>();

      for (const entry of entries) {
        if (entry.hours[day.day] <= 0) continue;
        const key = `${entry.project}\u0000${entry.task}`;
        recordedByAssignment.set(key, [
          ...(recordedByAssignment.get(key) ?? []),
          entry,
        ]);
      }

      for (const duplicates of recordedByAssignment.values()) {
        if (duplicates.length < 2) continue;
        const flaggedEntry = duplicates[1];
        if (!flaggedEntry) continue;
        issues.push({
          id: `duplicate-${day.day}-${flaggedEntry.id}`,
          type: "duplicate",
          title: `Potential duplicate entry on ${day.label}`,
          message: `${flaggedEntry.project} · ${flaggedEntry.task} appears more than once on ${day.date}. Compare the entries and keep both only if they represent separate work.`,
          cellId: `hours-${flaggedEntry.id}-${day.day}`,
        });
      }
    }

    return issues;
  }, [entries, timesheet.days, timesheet.expectedHours, weeklyTotal]);

  function updateHours(
    entryId: string,
    day: DayKey,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const parsed = Number.parseFloat(event.target.value);
    const hours = Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;

    setEntries((currentEntries) => {
      const nextEntries = currentEntries.map((entry) =>
        entry.id === entryId
          ? { ...entry, hours: { ...entry.hours, [day]: hours } }
          : entry,
      );
      latestEntries.current = nextEntries;
      return nextEntries;
    });
    setSaveState("saving");
    setSaveError(null);

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }

    saveTimer.current = setTimeout(() => void persistEntries(), 650);
  }

  async function persistEntries(): Promise<void> {
    if (!onSave) {
      setSaveState("saved");
      return;
    }
    if (saveInFlight.current) {
      savePending.current = true;
      return;
    }

    saveInFlight.current = true;
    savePending.current = false;
    setSaveState("saving");
    try {
      const updated = await onSave(latestEntries.current, version.current);
      version.current = updated.version ?? version.current + 1;
      setSaveState("saved");
      setSaveError(null);
    } catch (reason) {
      setSaveState("failed");
      setSaveError(
        reason instanceof Error
          ? reason.message
          : "Your changes could not be saved. Your entries remain on this page.",
      );
    } finally {
      saveInFlight.current = false;
      if (savePending.current) void persistEntries();
    }
  }

  function moveBetweenCells(
    event: KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    dayIndex: number,
  ) {
    const movement = {
      ArrowDown: [1, 0] as const,
      ArrowLeft: [0, -1] as const,
      ArrowRight: [0, 1] as const,
      ArrowUp: [-1, 0] as const,
    }[event.key];

    if (!movement) {
      return;
    }

    const nextRow = rowIndex + movement[0];
    const nextDay = dayIndex + movement[1];
    const nextCell = document.querySelector<HTMLInputElement>(
      `[data-hour-cell="${nextRow}-${nextDay}"]`,
    );

    if (nextCell) {
      event.preventDefault();
      nextCell.focus();
      nextCell.select();
    }
  }

  function focusIssue(cellId?: string) {
    if (!cellId) {
      return;
    }

    const mobileTarget = window.matchMedia?.("(max-width: 767px)").matches;
    const target = document.getElementById(
      mobileTarget ? `mobile-${cellId}` : cellId,
    );
    target?.focus();
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  async function submitTimesheet(): Promise<void> {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setIsSubmitting(true);
    setSaveError(null);
    try {
      if (onSubmit) {
        const updated = await onSubmit(latestEntries.current, version.current);
        version.current = updated.version ?? version.current + 2;
        setStatus(updated.status);
        setEntries(updated.entries);
        latestEntries.current = updated.entries;
      } else {
        setStatus(status === "rejected" ? "resubmitted" : "submitted");
      }
      setSaveState("saved");
      setSubmittedThisSession(true);
    } catch (reason) {
      setSaveState("failed");
      setSaveError(
        reason instanceof Error
          ? reason.message
          : "The timesheet could not be submitted. Your entries were preserved.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const saveStatePresentation = {
    saved: { icon: Check, label: onSave ? "Saved" : "Saved locally" },
    saving: { icon: Save, label: "Saving" },
    failed: { icon: Clock3, label: "Save failed" },
  }[saveState];
  const SaveIcon = saveStatePresentation.icon;

  return (
    <div className={styles.pageStack}>
      <PageHeader
        title={isLocked ? "Timesheet detail" : "My timesheet"}
        description="Record hours by assigned project and task, then review the complete week before submitting."
        meta={
          <Badge tone="secondary">
            {onSave ? "Connected workspace" : "Demo data"}
          </Badge>
        }
        action={
          <div className={styles.headerActionGroup}>
            <span className={styles.saveState} role="status" aria-live="polite">
              <SaveIcon aria-hidden="true" size={16} />
              {saveStatePresentation.label}
            </span>
            {!readOnly && (status === "draft" || status === "rejected") ? (
              <Dialog>
                <DialogTrigger asChild>
                  <Button>
                    <Send aria-hidden="true" size={17} />
                    Submit timesheet
                  </Button>
                </DialogTrigger>
                <DialogContent
                  title={`Submit ${timesheet.label}`}
                  description="Review the period summary before sending it to your manager."
                  footer={
                    <>
                      <DialogClose asChild>
                        <Button variant="secondary">Continue editing</Button>
                      </DialogClose>
                      <DialogClose asChild>
                        <Button
                          disabled={isSubmitting}
                          onClick={() => void submitTimesheet()}
                        >
                          {isSubmitting ? "Submitting…" : "Submit timesheet"}
                        </Button>
                      </DialogClose>
                    </>
                  }
                >
                  <div className={styles.submissionSummary}>
                    <dl>
                      <div>
                        <dt>Period</dt>
                        <dd>{timesheet.label}</dd>
                      </div>
                      <div>
                        <dt>Recorded</dt>
                        <dd>{formatHours(weeklyTotal)} hours</dd>
                      </div>
                      <div>
                        <dt>Expected</dt>
                        <dd>{formatHours(timesheet.expectedHours)} hours</dd>
                      </div>
                      <div>
                        <dt>Warnings</dt>
                        <dd>{liveIssues.length}</dd>
                      </div>
                    </dl>
                    <Alert
                      title="Review warnings before submission"
                      tone="warning"
                    >
                      Warnings do not automatically prevent submission in this
                      demo. Confirm that the entries accurately represent your
                      work.
                    </Alert>
                    <p className={styles.submissionConsequence}>
                      After submission, this timesheet becomes read-only while
                      it awaits manager review.
                    </p>
                  </div>
                </DialogContent>
              </Dialog>
            ) : null}
          </div>
        }
      />

      {saveError ? (
        <Alert
          title="Your latest change was not saved"
          tone="error"
          action={
            <Button variant="secondary" onClick={() => void persistEntries()}>
              Try saving again
            </Button>
          }
        >
          {saveError}
        </Alert>
      ) : null}

      <section className={styles.periodToolbar} aria-label="Timesheet period">
        {timesheet.previousPeriodId ? (
          <Link
            className={buttonClassName("secondary", "icon")}
            href={`/employee/timesheets/${timesheet.previousPeriodId}`}
            aria-label="Open previous period"
          >
            <ArrowLeft aria-hidden="true" size={18} />
          </Link>
        ) : (
          <Button
            variant="secondary"
            size="icon"
            disabled
            aria-label="No previous period"
          >
            <ArrowLeft aria-hidden="true" size={18} />
          </Button>
        )}

        <div className={styles.periodIdentity}>
          <span>Weekly period</span>
          <strong>{timesheet.label}</strong>
        </div>

        {timesheet.nextPeriodId ? (
          <Link
            className={buttonClassName("secondary", "icon")}
            href={
              timesheet.nextPeriodId === "2026-08-24"
                ? "/employee/timesheets/current"
                : `/employee/timesheets/${timesheet.nextPeriodId}`
            }
            aria-label="Open next period"
          >
            <ArrowRight aria-hidden="true" size={18} />
          </Link>
        ) : (
          <Button
            variant="secondary"
            size="icon"
            disabled
            aria-label="No next period"
          >
            <ArrowRight aria-hidden="true" size={18} />
          </Button>
        )}
      </section>

      <section
        className={styles.timesheetSummary}
        aria-labelledby="period-status-title"
      >
        <div>
          <span id="period-status-title">Timesheet status</span>
          <TimesheetStatusBadge status={status} />
          <p>{getStatusCopy(status)}</p>
        </div>
        <dl>
          <div>
            <dt>Recorded</dt>
            <dd>{formatHours(weeklyTotal)} h</dd>
          </div>
          <div>
            <dt>Expected</dt>
            <dd>{formatHours(timesheet.expectedHours)} h</dd>
          </div>
          <div>
            <dt>{varianceHours >= 0 ? "Remaining" : "Over expected"}</dt>
            <dd>{formatHours(Math.abs(varianceHours))} h</dd>
          </div>
        </dl>
      </section>

      {isLocked ? (
        submittedThisSession ? (
          <Alert title="Timesheet submitted" tone="success">
            Your timesheet is now read-only and awaiting manager review.
          </Alert>
        ) : (
          <Alert title="This timesheet is read-only" tone="info">
            <LockKeyhole aria-hidden="true" size={16} /> {getStatusCopy(status)}
          </Alert>
        )
      ) : (
        <div className={styles.validationStack} aria-label="Timesheet warnings">
          {liveIssues.map((issue) => (
            <Alert
              key={issue.id}
              title={issue.title}
              tone="warning"
              action={
                issue.cellId ? (
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => focusIssue(issue.cellId)}
                  >
                    Review entry
                  </Button>
                ) : undefined
              }
            >
              {issue.message}
            </Alert>
          ))}
        </div>
      )}

      {readOnly ? (
        <section
          className={styles.sectionBlock}
          aria-labelledby="submission-history-title"
        >
          <div className={styles.sectionHeader}>
            <h2 id="submission-history-title">Submission history</h2>
          </div>
          <dl className={styles.summaryMetrics}>
            <div>
              <dt>Submitted</dt>
              <dd>{timesheet.submittedAt ?? "Not available"}</dd>
            </div>
            <div>
              <dt>{status === "approved" ? "Approved by" : "Reviewed by"}</dt>
              <dd>{timesheet.approvedBy ?? "Not available"}</dd>
            </div>
            <div>
              <dt>Decision</dt>
              <dd>
                {status === "approved"
                  ? (timesheet.approvedAt ?? "Approved")
                  : status === "rejected"
                    ? "Returned for correction"
                    : "Awaiting review"}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section
        className={styles.timesheetSurface}
        aria-labelledby="entry-grid-title"
      >
        <div className={styles.surfaceHeader}>
          <div>
            <h2 id="entry-grid-title">Weekly entries</h2>
            <p>Use Tab or arrow keys to move between hour cells.</p>
          </div>
          {isLocked ? (
            <Badge tone="approved" icon="lock">
              Locked
            </Badge>
          ) : null}
        </div>

        <div className={styles.desktopTimesheetGrid}>
          <div className={styles.gridScroller}>
            <table className={styles.entryGrid}>
              <caption className={styles.visuallyHidden}>
                Hours by project, task, and day for {timesheet.label}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Task</th>
                  {timesheet.days.map((day) => (
                    <th scope="col" key={day.day}>
                      <span>{day.shortLabel}</span>
                      <small>{day.displayDate ?? day.date}</small>
                    </th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, rowIndex) => (
                  <tr key={entry.id}>
                    <th scope="row">{entry.project}</th>
                    <td className={styles.taskCell}>{entry.task}</td>
                    {timesheet.days.map((day, dayIndex) => {
                      const cellId = `hours-${entry.id}-${day.day}`;
                      const flagged = liveIssues.some(
                        (issue) => issue.cellId === cellId,
                      );

                      return (
                        <td
                          className={flagged ? styles.flaggedCell : undefined}
                          key={day.day}
                        >
                          <label
                            className={styles.visuallyHidden}
                            htmlFor={cellId}
                          >
                            {day.label}, {entry.project}, {entry.task}, hours
                          </label>
                          <input
                            id={cellId}
                            data-hour-cell={`${rowIndex}-${dayIndex}`}
                            aria-describedby={
                              flagged ? "duplicate-entry-note" : undefined
                            }
                            inputMode="decimal"
                            min="0"
                            readOnly={isLocked}
                            step="0.25"
                            type="number"
                            value={entry.hours[day.day]}
                            onChange={(event) =>
                              updateHours(entry.id, day.day, event)
                            }
                            onKeyDown={(event) =>
                              moveBetweenCells(event, rowIndex, dayIndex)
                            }
                          />
                        </td>
                      );
                    })}
                    <td className={styles.rowTotal}>
                      {formatHours(getEntryTotal(entry))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={2} scope="row">
                    Daily total
                  </th>
                  {timesheet.days.map((day) => (
                    <td key={day.day}>{formatHours(dailyTotals[day.day])}</td>
                  ))}
                  <td>{formatHours(weeklyTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className={styles.mobileTimesheetGrid}>
          {timesheet.days.map((day, dayIndex) => (
            <details key={day.day} open={dayIndex === 0}>
              <summary>
                <span>
                  <strong>{day.label}</strong>
                  <small>{day.displayDate ?? day.date}</small>
                </span>
                <span className={styles.mobileDayTotal}>
                  {formatHours(dailyTotals[day.day])} h
                  <ChevronDown aria-hidden="true" size={17} />
                </span>
              </summary>
              <div className={styles.mobileDayEntries}>
                {entries.map((entry) => {
                  const cellId = `mobile-hours-${entry.id}-${day.day}`;
                  const flagged = liveIssues.some(
                    (issue) => issue.cellId === `hours-${entry.id}-${day.day}`,
                  );

                  return (
                    <div className={styles.mobileEntryRow} key={entry.id}>
                      <label htmlFor={cellId}>
                        <strong>{entry.project}</strong>
                        <span>{entry.task}</span>
                      </label>
                      <div
                        className={
                          flagged ? styles.mobileFlaggedInput : undefined
                        }
                      >
                        <input
                          id={cellId}
                          aria-describedby={
                            flagged ? "duplicate-entry-note" : undefined
                          }
                          inputMode="decimal"
                          min="0"
                          readOnly={isLocked}
                          step="0.25"
                          type="number"
                          value={entry.hours[day.day]}
                          onChange={(event) =>
                            updateHours(entry.id, day.day, event)
                          }
                        />
                        <span>hours</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          ))}
          <div className={styles.mobileWeeklyTotal}>
            <span>Weekly total</span>
            <strong>{formatHours(weeklyTotal)} hours</strong>
          </div>
        </div>

        <p className={styles.visuallyHidden} id="duplicate-entry-note">
          This entry is included in a potential duplicate warning above the
          grid.
        </p>
      </section>

      {!readOnly && (status === "draft" || status === "rejected") ? (
        <div className={styles.mobileSubmitBar}>
          <div>
            <span>
              {formatHours(weeklyTotal)} of{" "}
              {formatHours(timesheet.expectedHours)} hours
            </span>
            <small>
              {varianceHours >= 0
                ? `${formatHours(varianceHours)} remaining`
                : `${formatHours(Math.abs(varianceHours))} over expected`}
            </small>
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button>Review and submit</Button>
            </DialogTrigger>
            <DialogContent
              title={`Submit ${timesheet.label}`}
              description="Review the period summary before sending it to your manager."
              footer={
                <>
                  <DialogClose asChild>
                    <Button variant="secondary">Continue editing</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button
                      disabled={isSubmitting}
                      onClick={() => void submitTimesheet()}
                    >
                      {isSubmitting ? "Submitting…" : "Submit timesheet"}
                    </Button>
                  </DialogClose>
                </>
              }
            >
              <p className={styles.submissionConsequence}>
                Submission will make this timesheet read-only. Current warnings
                remain visible for manager review.
              </p>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}
    </div>
  );
}
